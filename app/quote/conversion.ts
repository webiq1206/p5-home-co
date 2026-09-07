export function isNewAcceptedInquiry(
  status: number,
  payload: { accepted?: unknown },
  alreadyTracked: boolean,
): boolean {
  return status === 201 && payload.accepted === true && !alreadyTracked;
}