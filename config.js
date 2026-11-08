/*
 * Fair Tickets: site-wide settings for xdcoutpost.xyz/Fair_Tickets/
 * Every fair is set up from the Organiser app and travels inside its links,
 */
window.FAIR_CONFIG = {
  networks: {
    50: {
      label: 'XDC Network',
      rpc: 'https://rpc.plugin.global/xdcmainnet',
      factory: '0xcF60c53CcfA144B1810BCaabb2D2359C1A264e8D',            // FairFactory address on XDC Network
      factoryBlock: 109191074,        // block the factory was deployed in (speeds up the stats page)
      explorer: 'https://xdcscan.com'
    },
    51: {
      label: 'Practice (test network)',
      rpc: 'https://rpc.plugin.global/xdcapothem',
      factory: '0xCa69a56badE909a07Ba6b7533E056F93f06037dc',            // FairFactory address on Apothem
      factoryBlock: 85118345,
      explorer: 'https://testnet.xdcscan.com'
    }
  },

  // XDC loaded onto each booth and stall phone to cover its network fees.
  staffCredit: '10',
  // XDC kept on the organiser's phone for its own fees.
  organiserCredit: '10',

  // Where organisers buy XDC. Will modify these two lines to switch provider to whichever is appropriate
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
