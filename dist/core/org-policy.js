/** Only live evidence supplied by the adapter is trusted at execution time. */
export function isNonProductionOrg(org) {
    return org.isSandbox === true ||
        org.organizationType === "Developer Edition" ||
        (typeof org.verifiedScratchOrgId === "string" &&
            /^00D[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/.test(org.verifiedScratchOrgId) &&
            org.verifiedScratchOrgId.slice(0, 15) === org.orgId.slice(0, 15));
}
export function orgEnvironmentLabel(org) {
    if (!org || org.mode === "fake")
        return "오프라인 · Fake Adapter";
    if (org.isSandbox)
        return "Sandbox";
    if (org.verifiedScratchOrgId && isNonProductionOrg(org))
        return "Scratch Org";
    if (org.organizationType === "Developer Edition")
        return "Developer Edition";
    return "Production 또는 유형 미확인 · 쓰기 금지";
}
