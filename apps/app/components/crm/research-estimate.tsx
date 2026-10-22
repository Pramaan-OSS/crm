export function ResearchEstimate({output}: {output:Record<string,unknown>|null}) {
 if(output?.needsConfirmation !== true || typeof output.priceTypicalMicro !== 'number' || typeof output.priceMaxMicro !== 'number') return null;
 const money=(micro:number)=>`$${(micro/1_000_000).toFixed(6)}`;
 return <p><strong>usually about {money(output.priceTypicalMicro)}</strong><small className="block">at most {money(output.priceMaxMicro)}</small></p>;
}
