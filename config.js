/*
 * Fair Tickets: site-wide settings for xdcoutpost.xyz/Fair_Tickets/
 * Every fair is set up from the Organiser app and travels inside its links,
 * so one website serves any number of fairs.
 */
window.FAIR_CONFIG = {
  networks: {
    50: {
      label: 'XDC Network',
      rpc: 'https://rpc.plugin.global/xdcmainnet',
      factory: '',            // FairFactory address on XDC Network (set after deploying)
      factoryBlock: 0,        // block the factory was deployed in (speeds up the stats page)
      explorer: 'https://xdcscan.com'
    },
    51: {
      label: 'Practice (test network)',
      rpc: 'https://rpc.plugin.global/xdcapothem',
      factory: '',            // FairFactory address on Apothem (set after deploying)
      factoryBlock: 0,
      explorer: 'https://testnet.xdcscan.com'
    }
  },

  // XDC loaded onto each booth and stall phone to cover its network fees.
  staffCredit: '10',
  // XDC kept on the organiser's phone for its own fees.
  organiserCredit: '10',

  // Where organisers buy XDC. Change these two lines to switch provider.
  buyUrl: 'https://xdc.cash',
  buyName: 'xdc.cash',

  currency: '$',
  contactUrl: 'https://xdcoutpost.xyz/#contact',
  builtBy: 'XDC Outpost',
  builtByUrl: 'https://xdcoutpost.xyz',

  // Defaults offered in the organiser's setup wizard.
  defaults: {
    presets: [5, 10, 20, 50, 100],   // booth dollar buttons
    maxSaleTickets: 200,
    maxChargeTickets: 20,
    chargesPerMinute: 10,
    undoMinutes: 10,
    codeWindow: 60,
    largeSaleDollars: 100,
    lowTickets: 5
  }
};
