export interface BillingEntitlementsView {
  readonly features: readonly string[];
  readonly limits: Readonly<Record<string, number>>;
}
