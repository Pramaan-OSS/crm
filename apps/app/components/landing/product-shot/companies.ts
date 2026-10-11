export type MockCompany = {
	name: string;
	domain: string;
	logo?: { src: string; invert?: boolean };
	industry?: string;
	owner?: { name: string; avatar: string };
	contacts?: string;
	deals?: string;
	lastActivity?: string;
};

export const OWNER = {
	name: "Patrick Onusko",
	avatar: "/favicon.svg",
};

export const MOCK_COMPANIES: MockCompany[] = [
	{
		name: "Agentic CRM",
		domain: "agentic-crm.test",
		industry: "Retail & E-commerce",
		owner: OWNER,
		contacts: "1",
		deals: "0",
		lastActivity: "2h ago",
	},
	{
		name: "Tristar Fulfillment",
		domain: "tristarfulfillment.com",
		logo: { src: "/favicon.svg", invert: true },
	},
	{
		name: "AuditBot",
		domain: "auditbot.co",
		logo: { src: "/favicon.svg" },
	},
	{
		name: "Tawkeed",
		domain: "tawkeed.ai",
		logo: { src: "/favicon.svg" },
	},
	{
		name: "Piku",
		domain: "piku.com",
		logo: { src: "/favicon.svg" },
	},
	{
		name: "Roo Capital",
		domain: "roocapital.com",
		logo: { src: "/favicon.svg" },
	},
	{
		name: "Social Good Software",
		domain: "socialgoodsoftware.com",
		logo: { src: "/favicon.svg" },
	},
	{
		name: "Ridgetop",
		domain: "ridgetoptech.com",
		logo: { src: "/favicon.svg" },
	},
];

export const COMPANY_COLUMNS = [
	{ label: "Company", width: "26%" },
	{ label: "Domain", width: "16%" },
	{ label: "Industry", width: "16%" },
	{ label: "Owner", width: "16%" },
	{ label: "Contacts", width: "9%" },
	{ label: "Deals", width: "9%" },
	{ label: "Last activity", width: "12%" },
] as const;
