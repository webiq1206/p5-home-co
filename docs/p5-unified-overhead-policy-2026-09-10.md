# P5 unified overhead recovery

The owner's September 10 clarification supersedes the earlier separate 5% Nick,
5% Jared, 2% social media and 8% overhead allocation. This policy applies to new
calculations. Saved historical estimates retain their original financial records.

## Approved financial policy

- Official overhead: $35,000 per month or $420,000 per year.
- Listed Year 1 expenses total $414,168, leaving $5,832 of budget cushion.
- Both $100,000 salaries, employer burden, $60,000 annual advertising and $24,000
  social media support are already included. Advertising is counted once.
- Standard recovery: one 20% share of contract revenue. There are no additional
  owner or social-media percentages on top of it.
- Contract price = risk-adjusted direct cost / (1 - overhead rate - profit margin).
- Project contingency is included before division. Calculation precision is kept
  internally; only displayed amounts are rounded.

The approved 20% initial rate works without another revenue forecast. A missing
forecast or overdue quarterly review creates an administrator reminder instead
of withholding an otherwise supported planning range. A known higher requirement
continues to apply, including when its review is overdue.

Quarterly requirement = annual overhead / conservative annual earned revenue.
The applied rate is the greater of the approved rate and that requirement. At
$2.4 million, the mathematical requirement is 17.5%, while the approved rate stays
20%. At $2.1 million it is 20%; at $2 million it becomes 21%; at $1.4 million it
becomes 30%. Profit is not lowered to hide an overhead shortfall.

A deliberate rate below 20%, with a 17.5% minimum, requires a current documented
review of consistent earned revenue of at least $200,000/month and actual overhead
at or below $35,000/month. The sales goal alone does not authorize a reduction.

## Service profit policy

| Service | Standard target | Existing owner-approval floor | Stretch |
| --- | ---: | ---: | ---: |
| Handyman and RE-10 | 25% | 20% | 30% |
| Cabinet product only | 20% | 12% | 25% |
| Cabinet installation, kitchen, bathroom, whole-home | 20% | 15% | 25% |
| Addition and ADU | 15% | 12% | 20% |
| New construction | 15% | 10% | 20% |
| Change orders and rush work | 25% | 20% | 30% |

Ordinary work now uses the clarified 20% standard, including product-only cabinets
and whole-home remodeling. Existing minimum floors and both-owner exception
controls remain. Risk can raise a target within its service range. Any above-stretch
manual selection is flagged for review.

## Line-item treatment

Each internal item records its direct cost, contingency, risk-adjusted direct cost,
overhead recovery, operating profit, selling amount and selling price per unit.
Those components reconcile to the project totals without an extra overhead line.

Customer items show trade, description, quantity, unit, unit range and item range.
Their endpoints sum to the trade subtotals and overall planning range. The public
projection excludes direct costs, salary amounts, overhead rates, profit and source
evidence. Unit ranges are display-rounded; extended amounts control reconciliation.
Allowance amounts remain included once.

Both owner salaries are already overhead. Additional owner production is priced
only when its treatment states that it is additional project labor outside those
overhead-funded salaries, supported by replacement-cost evidence. The same salary
cannot also appear as a direct labor charge.

## Example estimates and unit costs

Historical examples inform individual units and scope comparisons. They are not
evidence that every printed amount is a current supplier or payroll cost.
The private reference browser shows supported unit-cost budgets at 15%, 20%, 25%
and 30% profit scenarios using the current overhead rate, before a project review
is created. Those budgets include room for project contingency. Scenario rows do
not override the selected service's profit safeguards. Flagged or unknown-basis
items do not receive a cost-budget conversion.

An authenticated project comparison also returns the direct-cost ceiling supported
by the selected comparable selling price:

Direct unit cost ceiling = comparable selling unit price *
(1 - overhead rate - target profit margin) / (1 + project contingency).

This is a budget limit, not an assertion of actual net cost. It lets the reviewer
compare the actual item cost with the selling price and required margin without
applying overhead and profit twice. Unclear units, alternatives and unknown price
bases remain flagged individually. Other valid examples can still be reviewed.

## Versioning and verification

The pricing version is part of scope and review fingerprints. Reviews and owner
approvals created under the old allocation policy cannot authorize a new result.
Reference comparisons also reject stale financial or project reviews. Historical
PDFs preserve their earlier allocation labels instead of rewriting saved amounts.

Verification includes 36 financial tests, real isolated SQL persistence with
simulated delivery, reference cost-budget and legacy-review rejection checks,
TypeScript, normal builds, customer browser interactions at seven widths and
isolated administrator-component checks at the same widths. Only completed runs
at the published branch commit establish a pass.

This remains a review-branch implementation. The approved overhead rate is no
longer a blocker. The earlier public-route migration, current-cost calibration,
production integrations, actual provider trials and physical-device checks retain
their separate status. No production deployment is implied by these changes.
