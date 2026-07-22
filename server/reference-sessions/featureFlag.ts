export function isMultiviewApprovalEnabled(): boolean {
  const envVal = process.env.MULTIVIEW_APPROVAL_ENABLED;
  if (!envVal) return false;
  return envVal.trim().toLowerCase() === "true" || envVal.trim() === "1";
}

export function assertMultiviewApprovalEnabled(): void {
  if (!isMultiviewApprovalEnabled()) {
    const error = new Error("Multiview Reference Approval feature is currently disabled on the server.");
    (error as any).code = "FEATURE_DISABLED";
    throw error;
  }
}
