// SPDX-License-Identifier: MIT
// Fair Tickets by XDC Outpost (https://xdcoutpost.xyz)
pragma solidity 0.8.24;

import {FairTickets} from "./FairTickets.sol";

/// @title  FairFactory
/// @notice Creates every Fair Tickets fair and keeps a list of them, so the apps
///         can tell an official fair from a look-alike and totals can be counted.
contract FairFactory {
    address[] public fairs;
    mapping(address => bool) public isFair;

    event FairCreated(address indexed fair, address indexed organiser, string name, uint256 index);

    function createFair(
        string calldata name,
        uint256 tickets,
        uint256 cents,
        FairTickets.Limits calldata limits,
        uint64 autoCloseAt,
        string[] calldata groups,
        uint24[] calldata colours
    ) external returns (address fair) {
        fair = address(new FairTickets(msg.sender, name, tickets, cents, limits, autoCloseAt, groups, colours));
        isFair[fair] = true;
        fairs.push(fair);
        emit FairCreated(fair, msg.sender, name, fairs.length - 1);
    }

    function fairCount() external view returns (uint256) {
        return fairs.length;
    }
}
