export interface OwnedReferenceSession {
  id: string;
  user_phone: string;
  status: string;
}

export async function resolveOwnedReferenceSession<T extends OwnedReferenceSession>(
  requestedSessionId: unknown,
  userPhone: string,
  getOwnedSession: (id: string, userPhone: string) => Promise<T | null>,
  createId: () => string,
): Promise<{ id: string; session: T | null }> {
  const requested = typeof requestedSessionId === "string"
    ? requestedSessionId.trim()
    : "";
  if (requested) {
    const session = await getOwnedSession(requested, userPhone);
    if (session) return { id: session.id, session };
  }
  return { id: createId(), session: null };
}
