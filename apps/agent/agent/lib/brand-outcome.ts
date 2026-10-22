import {
	type OutcomeApproval,
	type Pramaan,
	runOutcomeFlow,
} from "@crm/pramaan";

export function brandLogo(
	api: Pramaan,
	domain: string,
	approval: OutcomeApproval = {},
) {
	return runOutcomeFlow(
		api,
		"company.brand.kit",
		{ domain },
		{ storeLogo: true },
		approval,
	);
}
