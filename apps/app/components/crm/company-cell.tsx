import { companyLogoProps } from "@crm/db/images";
import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import { EntityLogo } from "@crm/ui/components/entity-logo";

export type CompanyRef = {
	id: string;
	name: string;
	domain: string | null;
	iconUrl: string | null;
	iconDarkUrl?: string | null;
	iconTone?: string | null;
	logoUrl?: string | null;
	logoDarkUrl?: string | null;
};

export function CompanyCell({ company }: { company: CompanyRef | null }) {
	if (!company) return <EmptyCellValue />;

	return (
		<span className="flex min-w-0 items-center gap-2">
			<EntityLogo
				{...companyLogoProps(company)}
				name={company.name}
				size="sm"
			/>
			<span className="truncate">{company.name}</span>
		</span>
	);
}
