// SPDX-License-Identifier: MIT
// Fair Tickets by XDC Outpost (https://xdcoutpost.xyz)
pragma solidity 0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title  FairTickets
/// @notice Phone tickets for one fair. Tickets replace paper tickets: they are
///         sold at booths, charged by stalls, and have no value once the fair closes.
///         Families never send tickets themselves. Only the organiser, booths and
///         stalls act, each within limits this contract enforces.
/// @dev    Amounts are in hundredths of a ticket (decimals = 2).
contract FairTickets {
    // ------------------------------------------------------------------ types
    uint8 public constant NONE = 0;
    uint8 public constant BOOTH = 1;
    uint8 public constant STALL = 2;

    uint8 public constant SALE = 1;
    uint8 public constant CHARGE = 2;

    uint8 public constant CASH = 0;
    uint8 public constant CARD = 1;
    uint8 public constant REISSUE = 2;

    struct Limits {
        uint128 maxSale;          // per booth sale, hundredths of a ticket
        uint128 maxCharge;        // per stall charge, hundredths of a ticket
        uint32 chargesPerMinute;  // per family
        uint32 undoWindow;        // seconds a booth may undo its own sale
        uint32 codeWindow;        // seconds either side of now a QR code is accepted
    }

    struct Record {
        uint8 kind;       // SALE or CHARGE
        uint8 method;     // CASH, CARD, REISSUE (sales only)
        address staff;    // booth or stall that made it
        address family;
        uint128 amount;
        uint128 returned; // undone or refunded so far
        uint64 time;
    }

    // ------------------------------------------------------------------ state
    string public name;
    string public constant symbol = "TIX";
    uint8 public constant decimals = 2;
    uint256 public totalSupply;

    address public immutable organiser;
    address public immutable factory;
    uint256 public immutable createdAtBlock;
    uint256 public centsPerTicket;
    uint64 public autoCloseAt;
    bool public closed;
    Limits public limits;

    mapping(address => uint256) public balanceOf;
    mapping(address => uint8) public role;
    mapping(address => string) public label;
    mapping(address => bool) public featured;

    string[] private groupNames;
    uint24[] private groupColours;
    mapping(address => uint8) public groupOf; // 0 = none, else 1-based

    mapping(bytes32 => bool) public usedCode;
    mapping(address => uint64) private chargeMinute;
    mapping(address => uint32) private chargeCountInMinute;

    Record[] private records;

    // ------------------------------------------------------------------ events
    event Transfer(address indexed from, address indexed to, uint256 value);
    event StaffSet(address indexed phone, uint8 role, string label, bool featured);
    event Sold(uint256 indexed id, address indexed booth, address indexed family, uint256 amount, uint8 method, uint8 group);
    event SaleUndone(uint256 indexed id, address indexed booth, address indexed family, uint256 amount);
    event Charged(uint256 indexed id, address indexed stall, address indexed family, uint256 amount);
    event Refunded(uint256 indexed id, address indexed stall, address indexed family, uint256 amount);
    event Corrected(address indexed from, address indexed to, uint256 amount, string reason);
    event FamilyGroupSet(address indexed family, uint8 group);
    event SettingsChanged(string name, uint256 centsPerTicket, uint64 autoCloseAt);
    event LimitsChanged(uint128 maxSale, uint128 maxCharge, uint32 chargesPerMinute, uint32 undoWindow, uint32 codeWindow);
    event GroupsSet(string[] names, uint24[] colours);
    event Closed(uint256 time);

    // ------------------------------------------------------------------ modifiers
    modifier onlyOrganiser() {
        require(msg.sender == organiser, "Only the organiser");
        _;
    }

    modifier whenOpen() {
        require(isOpen(), "This fair has closed");
        _;
    }

    // ------------------------------------------------------------------ setup
    constructor(
        address organiser_,
        string memory name_,
        uint256 tickets,
        uint256 cents,
        Limits memory limits_,
        uint64 autoCloseAt_,
        string[] memory groups_,
        uint24[] memory colours_
    ) {
        require(organiser_ != address(0), "Bad organiser");
        require(cents > 0, "Price required");
        organiser = organiser_;
        factory = msg.sender;
        createdAtBlock = block.number;
        name = name_;
        centsPerTicket = cents;
        autoCloseAt = autoCloseAt_;
        _setLimits(limits_);
        _setGroups(groups_, colours_);
        totalSupply = tickets;
        balanceOf[organiser_] = tickets;
        emit Transfer(address(0), organiser_, tickets);
        emit SettingsChanged(name_, cents, autoCloseAt_);
    }

    // ------------------------------------------------------------------ views
    function isOpen() public view returns (bool) {
        return !closed && (autoCloseAt == 0 || block.timestamp < autoCloseAt);
    }

    function groups() external view returns (string[] memory names, uint24[] memory colours) {
        return (groupNames, groupColours);
    }

    function recordCount() external view returns (uint256) {
        return records.length;
    }

    function getRecord(uint256 id) external view returns (Record memory) {
        return records[id];
    }

    /// Tickets can't be approved or sent directly; kept for wallet and explorer compatibility.
    function allowance(address, address) external pure returns (uint256) {
        return 0;
    }

    function transfer(address, uint256) external pure returns (bool) {
        revert("Tickets move only through the fair's booths and stalls");
    }

    function transferFrom(address, address, uint256) external pure returns (bool) {
        revert("Tickets move only through the fair's booths and stalls");
    }

    function approve(address, uint256) external pure returns (bool) {
        revert("Tickets move only through the fair's booths and stalls");
    }

    // ------------------------------------------------------------------ organiser
    /// Add, rename or remove a booth or stall, optionally loading tickets and XDC for fees.
    function setStaff(address phone, uint8 role_, string calldata label_, bool featured_, uint256 tickets)
        external
        payable
        onlyOrganiser
        whenOpen
    {
        require(phone != address(0) && phone != organiser, "Bad phone");
        require(role_ <= STALL, "Bad role");
        role[phone] = role_;
        label[phone] = label_;
        featured[phone] = role_ == STALL && featured_;
        emit StaffSet(phone, role_, label_, featured[phone]);
        if (tickets > 0) {
            require(role_ == BOOTH, "Only booths hold tickets to sell");
            _move(organiser, phone, tickets);
        }
        _forward(phone);
    }

    /// Give more tickets to a booth.
    function allocate(address booth, uint256 tickets) external onlyOrganiser whenOpen {
        require(role[booth] == BOOTH, "Not a booth");
        _move(organiser, booth, tickets);
    }

    /// Move tickets to fix a mistake on the day. Always recorded with a reason.
    function correct(address from, address to, uint256 amount, string calldata reason)
        external
        onlyOrganiser
        whenOpen
    {
        require(bytes(reason).length > 0, "Reason required");
        _move(from, to, amount);
        emit Corrected(from, to, amount, reason);
    }

    function setFamilyGroup(address family, uint8 group) external onlyOrganiser whenOpen {
        require(group <= groupNames.length, "Bad group");
        groupOf[family] = group;
        emit FamilyGroupSet(family, group);
    }

    function setSettings(string calldata name_, uint256 cents, uint64 autoCloseAt_) external onlyOrganiser whenOpen {
        require(cents > 0, "Price required");
        require(autoCloseAt_ == 0 || autoCloseAt_ > block.timestamp, "Close time has passed");
        name = name_;
        centsPerTicket = cents;
        autoCloseAt = autoCloseAt_;
        emit SettingsChanged(name_, cents, autoCloseAt_);
    }

    function setLimits(Limits calldata limits_) external onlyOrganiser whenOpen {
        _setLimits(limits_);
    }

    function setGroups(string[] calldata names, uint24[] calldata colours) external onlyOrganiser whenOpen {
        require(names.length >= groupNames.length, "Groups can be added or renamed, not removed");
        _setGroups(names, colours);
    }

    /// Freeze the fair for good. Records stay readable forever.
    function close() external onlyOrganiser whenOpen {
        closed = true;
        emit Closed(block.timestamp);
    }

    // ------------------------------------------------------------------ booths
    /// Sell tickets to a family. method: 0 cash, 1 card, 2 compassionate reissue.
    function sell(address family, uint256 amount, uint8 method, uint8 group)
        external
        whenOpen
        returns (uint256 id)
    {
        require(role[msg.sender] == BOOTH, "Not a booth");
        require(method <= REISSUE, "Bad method");
        require(amount > 0 && amount <= limits.maxSale, "Amount over the sale limit");
        require(family != address(0) && role[family] == NONE && family != organiser, "Not a family code");
        _move(msg.sender, family, amount);
        if (groupOf[family] == 0 && group > 0 && group <= groupNames.length) {
            groupOf[family] = group;
            emit FamilyGroupSet(family, group);
        }
        id = _record(SALE, method, family, amount);
        emit Sold(id, msg.sender, family, amount, method, groupOf[family]);
    }

    /// Undo (part of) this booth's own sale, within the undo window.
    function undoSale(uint256 id, uint256 amount) external whenOpen {
        Record storage r = records[id];
        require(r.kind == SALE && r.staff == msg.sender, "Not this booth's sale");
        require(block.timestamp <= r.time + limits.undoWindow, "Too late to undo");
        require(amount > 0 && amount <= r.amount - r.returned, "More than the sale");
        r.returned += uint128(amount);
        _move(r.family, msg.sender, amount);
        emit SaleUndone(id, msg.sender, r.family, amount);
    }

    // ------------------------------------------------------------------ stalls
    /// Charge a family, using the signed code shown on their phone.
    function charge(
        address family,
        uint64 codeTime,
        uint64 nonce,
        uint8 group,
        bytes32 r,
        bytes32 vs,
        uint256 amount
    ) external whenOpen returns (uint256 id) {
        require(role[msg.sender] == STALL, "Not a stall");
        require(amount > 0 && amount <= limits.maxCharge, "Amount over the charge limit");
        require(
            uint256(codeTime) + limits.codeWindow >= block.timestamp &&
                uint256(codeTime) <= block.timestamp + limits.codeWindow,
            "Code expired"
        );
        bytes32 h = keccak256(
            abi.encodePacked("FairTickets charge permit", address(this), block.chainid, family, codeTime, nonce, group)
        );
        require(!usedCode[h], "Code already used");
        require(ECDSA.recover(MessageHashUtils.toEthSignedMessageHash(h), r, vs) == family, "Not a valid code");
        usedCode[h] = true;

        uint64 minute = uint64(block.timestamp / 60);
        if (chargeMinute[family] != minute) {
            chargeMinute[family] = minute;
            chargeCountInMinute[family] = 0;
        }
        require(chargeCountInMinute[family] < limits.chargesPerMinute, "Too many charges, wait a moment");
        chargeCountInMinute[family] += 1;

        _move(family, msg.sender, amount);
        id = _record(CHARGE, 0, family, amount);
        emit Charged(id, msg.sender, family, amount);
    }

    /// Refund (part of) this stall's own charge.
    function refund(uint256 id, uint256 amount) external whenOpen {
        Record storage rec = records[id];
        require(rec.kind == CHARGE && rec.staff == msg.sender, "Not this stall's charge");
        require(amount > 0 && amount <= rec.amount - rec.returned, "More than the charge");
        rec.returned += uint128(amount);
        _move(msg.sender, rec.family, amount);
        emit Refunded(id, msg.sender, rec.family, amount);
    }

    // ------------------------------------------------------------------ internals
    function _move(address from, address to, uint256 amount) internal {
        require(to != address(0), "Bad address");
        uint256 bal = balanceOf[from];
        require(bal >= amount, "Not enough tickets");
        unchecked {
            balanceOf[from] = bal - amount;
        }
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }

    function _record(uint8 kind, uint8 method, address family, uint256 amount) internal returns (uint256 id) {
        id = records.length;
        records.push(Record(kind, method, msg.sender, family, uint128(amount), 0, uint64(block.timestamp)));
    }

    function _setLimits(Limits memory l) internal {
        require(l.maxSale > 0 && l.maxCharge > 0 && l.chargesPerMinute > 0, "Bad limits");
        require(l.codeWindow >= 30 && l.codeWindow <= 600, "Bad code window");
        limits = l;
        emit LimitsChanged(l.maxSale, l.maxCharge, l.chargesPerMinute, l.undoWindow, l.codeWindow);
    }

    function _setGroups(string[] memory names, uint24[] memory colours) internal {
        require(names.length == colours.length && names.length <= 20, "Bad groups");
        delete groupNames;
        delete groupColours;
        for (uint256 i = 0; i < names.length; i++) {
            groupNames.push(names[i]);
            groupColours.push(colours[i]);
        }
        emit GroupsSet(names, colours);
    }

    function _forward(address to) internal {
        if (msg.value > 0) {
            (bool ok, ) = payable(to).call{value: msg.value}("");
            require(ok, "Credit forward failed");
        }
    }
}
