// Vendors — consolidated portal + price-sheet links, sourced from the CFC
// intranet "Vendor Website / Price List" page. Each vendor has:
//   name        display name
//   domain      brand domain used to fetch a logo (null → lettered fallback)
//   website     vendor login / catalog portal (null → no Website button)
//   pricesheets [{ label, url }]  Drive PDFs / Google Sheets (may be empty)
//
// Rendered on the Quick Access page as a logo card with Website + Price Sheet
// buttons. Logos are pulled at render time from the brand domain (see
// VendorLogo in CPanel.jsx) — no images are bundled.

const drive = (id) => `https://drive.google.com/file/d/${id}/view`;

export const VENDORS = [
  {
    name: 'AICO',
    domain: 'amini.com',
    website: 'http://portal.amini.com/cp_login.asp',
    pricesheets: [
      { label: 'Casegood', url: drive('1NCgUP4P640jMJ9BtqIS8P4X8iI_LmQwb') },
      { label: 'Upholstery', url: drive('1cOMZKa2AEQJSM81wu4gZaaVY5xEbI7Ig') },
    ],
  },
  {
    name: 'American Drew',
    domain: 'americandrew.com',
    website: null,
    pricesheets: [{ label: 'Price List', url: drive('1e5mYDFU0LNYZmxPpS2LDVZW7fw24uUwl') }],
  },
  {
    name: 'Ashley',
    domain: 'ashleyfurniture.com',
    website: 'https://www.ashleydirect.com/SiteLogin/Forms/Login.aspx?hsa=1&hcu=1',
    pricesheets: [],
  },
  {
    name: 'Avalon',
    domain: 'avalonfurniture.com',
    website: 'https://cms.amptab.com/Manufacturer/124982/Shop2Catalog',
    pricesheets: [{ label: 'Price List', url: drive('15OZl213fi_R4GoLS2zKUMAYFPC3DtUzh') }],
  },
  {
    name: 'Barcalounger',
    domain: 'barcalounger.com',
    website: 'https://cms.amptab.com/',
    pricesheets: [{ label: 'Price List', url: drive('19SrnEHbEsDs95i_kV04CQWOfhwmdGTqh') }],
  },
  {
    name: 'Best Home Furnishings',
    domain: 'besthf.com',
    website: 'https://www.besthf.com/bcservice/dealerLogon.do?action=initial',
    pricesheets: [{ label: 'Price List', url: drive('17BFf0MKetXPyPGzISr1idRN5XU2dwpr1') }],
  },
  {
    name: 'Coaster',
    domain: 'coasterfurniture.com',
    website: 'https://coaster.coasteramer.com/account/login/default.aspx',
    pricesheets: [],
  },
  {
    name: 'Craftmaster',
    domain: 'craftmasterfurniture.com',
    website: 'https://portal.cmfurniture.com/customer/',
    pricesheets: [
      { label: 'Price List', url: drive('1-H_kAzvqK42Efia6QexWBbV8mn0J9DsP') },
      { label: 'Paula Deen', url: drive('112fMlarOIrb4zNk-FDofMETfbuyUqCWE') },
    ],
  },
  {
    name: 'England Furniture',
    domain: 'englandfurniture.com',
    website: 'https://extranet2013.englandfurniture.com/_layouts/15/viewlsts.aspx?BaseType=1&ListTemplate=109',
    pricesheets: [{ label: 'Price List', url: drive('1P7d3A6MkL1EqJkthY0P_FoRYgL4mgTEM') }],
  },
  {
    name: 'Englander',
    domain: 'englander.com',
    website: null,
    pricesheets: [{ label: 'Price List', url: drive('1mkAba3vMeL9F-_qTgd_UVae2gAUEPKYk') }],
  },
  {
    name: 'Flexsteel',
    domain: 'flexsteel.com',
    website: 'http://backroom.flexsteel.com/Account/Login.aspx?ReturnUrl=%2f',
    pricesheets: [{ label: 'Yard & Pillow', url: drive('1Da_xwoeoRFAK3o7iqIu3KJzPqFStEn-a') }],
  },
  {
    name: 'Fireside Lodge',
    domain: 'firesidelodgefurniture.com',
    website: 'https://ecatalogs.plytix.com/63cac4fa5de202bcbdb577a5',
    pricesheets: [{ label: 'Price List', url: drive('19uAMYaXTic5tCICPJq-OdpsTubF5ur6L') }],
  },
  {
    name: 'Franklin',
    domain: 'franklincorp.com',
    website: 'https://sfa.franklincorp.com/nexuspublic/login.pgm',
    pricesheets: [
      { label: 'Stationary', url: drive('1AqCTnIwz3igSOJu885fwp9yohCm1st7T') },
      { label: 'Motion', url: drive('1NQkdgqeJ8sznTD84JeFNpAQZ6ThK2C3N') },
      { label: 'Recliner', url: drive('178XiRAXDTiUFTs5fosWG77IxYj96KnBQ') },
    ],
  },
  {
    name: 'Fusion Furniture',
    domain: 'fusionfurnitureinc.com',
    website: 'https://cms.amptab.com',
    pricesheets: [{ label: 'Price List', url: drive('1LCfdhAeSg_vSpYuyKUhyDFnyoA0WIGWK') }],
  },
  {
    name: 'Furniture of America',
    domain: 'foagroup.com',
    website: 'https://www.foagroup.com/pricebook/get/index/',
    pricesheets: [{ label: 'Price List', url: drive('1HysgQ8lyrf496TTre1ua1qlFX3zjTv2u') }],
  },
  {
    name: 'Hammary',
    domain: 'hammary.com',
    website: null,
    pricesheets: [{ label: 'Price List', url: drive('1S-jGUKe17SRkxLe-JnFtjS_ge4lbBetH') }],
  },
  {
    name: 'Hooker Furniture',
    domain: 'hookerfurniture.com',
    website: 'https://www.hookerfurniture.com/dealer-login.inc',
    pricesheets: [{ label: 'Price List', url: drive('1Iqix6emqfd5yLv5zHDicnyMzv3OJCasy') }],
  },
  {
    name: 'Infinity',
    domain: null,
    website: null,
    pricesheets: [{ label: 'Price List', url: drive('1NOoGMtpGSacyWNhPDdFcr4nL-pLv6DKa') }],
  },
  {
    name: 'Jackson / Catnapper',
    domain: 'catnapper.com',
    website: 'https://gojfi.com/',
    pricesheets: [
      { label: 'Jackson', url: drive('1mdLCxaZG8TlhSZA90lQC5vBB_viBCnjg') },
      { label: 'Catnapper', url: drive('1_uwcv6aYxfBLSFvFW9ci9z7ynZ9d5nhR') },
    ],
  },
  {
    name: 'Johnson City Bedding',
    domain: null,
    website: null,
    pricesheets: [{ label: 'Price Sheet', url: 'https://docs.google.com/spreadsheets/d/1oGZd_w_rtxzflKVBLPZ-wM5bgIsg5nFX/edit?usp=drive_link&ouid=114157042830898524372&rtpof=true&sd=true' }],
  },
  {
    name: 'Kincaid',
    domain: 'kincaidfurniture.com',
    website: null,
    pricesheets: [{ label: 'Price List', url: drive('1eLLMkZ-7Z-u2HCQuInh6hrrh7a8T90Eq') }],
  },
  {
    name: 'La-Z-Boy',
    domain: 'la-z-boy.com',
    website: 'https://core.la-z-boy.com/Account/Login?ReturnUrl=%2F',
    pricesheets: [],
  },
  {
    name: 'Legacy Classic',
    domain: 'legacyclassicfurniture.com',
    website: 'http://legacyclassic.imagesolutionsint.com/login',
    pricesheets: [{ label: 'Price List', url: drive('1hoW_l5IGBuhz0kiLT9TeBLUvl4utCjCD') }],
  },
  {
    name: 'Liberty',
    domain: 'libertyfurniture.com',
    website: 'https://www.mylibertyfurniture.com/login-or-register',
    pricesheets: [{ label: 'Price List', url: drive('1dbxumO9HV2O-g_Sb-uT3z8cTmQr0D0LX') }],
  },
  {
    name: 'Magnussen',
    domain: 'magnussen.com',
    website: 'http://mhsfi.magnussen.com/wave/portal.aspx#/',
    pricesheets: [{ label: 'Price List', url: 'https://docs.google.com/spreadsheets/d/1Nt7A1Vj1acxRge0ylAKXfkLM0yybqha5ZGgOfu_1-Bk/edit?usp=sharing' }],
  },
  {
    name: 'Malouf',
    domain: 'maloufhome.com',
    website: null,
    pricesheets: [{ label: 'Price List', url: drive('11HvRVYgypPqU-p7bXY4T3X01NJ9kXkVK') }],
  },
  {
    name: 'Mega Motion',
    domain: 'megamotion.com',
    website: null,
    pricesheets: [{ label: 'Price List', url: drive('1IoEBWiXaPybYFIqbswtJxWbar7pJb9yO') }],
  },
  {
    name: 'Natuzzi',
    domain: 'natuzzi.com',
    website: 'https://nares.natuzzi.com/mycatalog',
    pricesheets: [{ label: 'Price List', url: drive('1N8kC8sk1U9IXLA2hi1nC_OM9wSab-1XV') }],
  },
  {
    name: 'Nourison',
    domain: 'nourison.com',
    website: null,
    pricesheets: [{ label: 'Price List', url: drive('18dDECjHJxzj9AxTLNTSABCLuCsqV_Y7b') }],
  },
  {
    name: 'Palliser',
    domain: 'palliser.com',
    website: 'https://my.palliser.com/',
    pricesheets: [{ label: 'Price List', url: drive('1ytvCo3hvCxh1rJYoHVIhocPYAHHxMF5a') }],
  },
  {
    name: 'Parker House',
    domain: 'parkerhouse.com',
    website: 'https://parker-house.com/account',
    pricesheets: [],
  },
  {
    name: 'Pulaski',
    domain: 'pulaskifurniture.com',
    website: 'http://salesportal.homemeridian.com/',
    pricesheets: [{ label: 'Price List', url: drive('12Ohdp-5FIueJ6ySGMgAZ-VfDZrNKOykW') }],
  },
  {
    name: 'Rutherford Home',
    domain: null,
    website: null,
    pricesheets: [{ label: 'Price List', url: drive('1ytiLVl1PhXjyLX34R5XVIoOw3vRd7yhw') }],
  },
  {
    name: 'Southern Motion',
    domain: 'southernmotion.com',
    website: 'https://www.southernmotion.com/login/',
    pricesheets: [
      { label: 'Price List', url: drive('1RdThmkK3X_Spt1UJA96kgD9FpEC5U8cV') },
      { label: 'Revive', url: drive('1W37aULcwTDBAs5gduV6NGh1f3YUUdL2U') },
    ],
  },
  {
    name: 'Stearns & Foster',
    domain: 'stearnsandfoster.com',
    website: null,
    pricesheets: [{ label: 'Price List', url: drive('1knovf2EEsI9eU0mu4bjgPhBmIojwM4IV') }],
  },
  {
    name: 'Surya',
    domain: 'surya.com',
    website: 'https://surya.com/Sign-in/',
    pricesheets: [{ label: 'Price List', url: drive('1xxlqvs4avJz-ewO3dDJiqo84xVPlDawf') }],
  },
  {
    name: 'Tempur-Pedic',
    domain: 'tempurpedic.com',
    website: 'https://cam.am.tempursealy.com/RSTS/Login?wa=wsignin1.0&wtrealm=urn%3acam.am.tempursealy.com%2fCloudAccessManager%2fRPSTS&wreply=https%3a%2f%2fcam.am.tempursealy.com%2fCloudAccessManager%2fRPSTS%2fWSFed%2fLogin.aspx&primaryProviderID=ActiveDirectory_3',
    pricesheets: [{ label: 'Price List', url: drive('1Af5eBn_Zy1cOeIiHFrcupK2sA8JffiMY') }],
  },
  {
    name: 'Vaughan Bassett',
    domain: 'vaughan-bassett.com',
    website: null,
    pricesheets: [{ label: 'Price List', url: drive('18JW7-RFvUO3d1sFnMZ5pu8w09a1U-gO-') }],
  },
];
