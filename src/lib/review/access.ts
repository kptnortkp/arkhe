// Pure visibility rules for recordings, assistant notes and the conductor's comment. Every route,
// page, action and query decides with these (or with SQL that mirrors them), never with hidden UI.
//
// | Who                         | Audio of X                 | Review page of X | Notes on X | Comment on X |
// | X (the singer)              | yes, download too          | 404              | never      | yes          |
// | Conductor                   | yes, download too          | yes              | all        | writes it    |
// | Assistant in scope, not X   | until the comment (D43)    | yes              | own only   | never (D10)  |
// | Board (D45), other members  | 404                        | 404              | never      | board reads  |
import type { Role, VoicePart } from "@/db/schema";

export type Viewer = { id: string; role: Role };
/** The viewer's effective appointment: the parts in scope, [] when not an assistant. */
export type Scope = readonly VoicePart[];
export type SingerRef = { id: string; voicePart: VoicePart | null };

export const isConductor = (role: Role) => role === "conductor";
/** D3: only the conductor writes the comment the singer sees. */
export const canWriteFeedback = isConductor;
/** D9: only the conductor appoints assistants. */
export const canManageAssistants = isConductor;
/** D19: the early-clean lever is the conductor's. */
export const canEarlyClean = isConductor;

/** D9: an appointment counts only for an active member or board user (active is the session's). */
export function effectiveScope(viewer: Viewer, scope: Scope): Scope {
  return viewer.role === "member" || viewer.role === "board" ? scope : [];
}

export function covers(scope: Scope, singer: SingerRef) {
  return singer.voicePart !== null && scope.includes(singer.voicePart);
}

/** As an assistant: in scope, never one's own recording (D9). */
export function assistsFor(viewer: Viewer, scope: Scope, singer: SingerRef) {
  return viewer.id !== singer.id && covers(effectiveScope(viewer, scope), singer);
}

/** The audio bytes. An assistant loses access once the conductor has commented (D43). */
export function canListen(viewer: Viewer, scope: Scope, singer: SingerRef, commented: boolean) {
  if (viewer.id === singer.id || isConductor(viewer.role)) return true;
  return !commented && assistsFor(viewer, scope, singer);
}

/** `?indir=1`: owner and conductor only (D44). */
export function canDownload(viewer: Viewer, singer: SingerRef) {
  return viewer.id === singer.id || isConductor(viewer.role);
}

export type ReviewRole = "conductor" | "assistant";

/** /odevler/<id>/dinle/<userId>: which view the viewer gets, or null for 404 (D29). */
export function reviewRole(viewer: Viewer, scope: Scope, singer: SingerRef): ReviewRole | null {
  if (isConductor(viewer.role)) return viewer.id === singer.id ? null : "conductor";
  return assistsFor(viewer, scope, singer) ? "assistant" : null;
}

/** /odevler/dinle: conductor, or anybody with an effective appointment. */
export function canSeeQueue(viewer: Viewer, scope: Scope) {
  return isConductor(viewer.role) || effectiveScope(viewer, scope).length > 0;
}
