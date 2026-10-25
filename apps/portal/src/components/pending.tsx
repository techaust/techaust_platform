// Copy that 07-N hasn't approved yet (copy-documents.ts PENDING): every drafted sentence and heading carries a visible
// "[Placeholder]" tag, so nobody mistakes it for final wording (the M4.5 brief). Short control labels drawn from the brief
// ("Full name", "Decline", "Back") are listed in PENDING too but shown untagged, so the controls stay readable. When 07-N
// is approved, its words move into WORDS and this wrapper goes.
export function Ph({ children }: { children: string }) {
  return (
    <>
      <span className="ph">[Placeholder]</span> {children}
    </>
  );
}
