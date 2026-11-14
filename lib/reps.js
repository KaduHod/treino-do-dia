/**
 * Interpreta anotações de repetições nos formatos mais comuns:
 *   "3x12"      -> 3 séries de 12
 *   "3 x 10-12" -> 3 séries de 10 a 12 (média usada no volume)
 *   "12"        -> 1 série de 12
 * Retorna null quando o formato não é reconhecido (ex: "AMRAP", "30s").
 */
export function parseReps(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;

  const multipleSets = text.match(/^(\d+)\s*[x×]\s*(\d+)(?:\s*-\s*(\d+))?$/i);
  if (multipleSets) {
    const sets = Number(multipleSets[1]);
    const lower = Number(multipleSets[2]);
    const upper = multipleSets[3] ? Number(multipleSets[3]) : lower;
    if (!sets || !lower) return null;
    const repsPerSet = (Math.min(lower, upper) + Math.max(lower, upper)) / 2;
    return { sets, repsPerSet, totalReps: sets * repsPerSet };
  }

  const singleSet = text.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
  if (singleSet) {
    const lower = Number(singleSet[1]);
    const upper = singleSet[2] ? Number(singleSet[2]) : lower;
    if (!lower) return null;
    const repsPerSet = (Math.min(lower, upper) + Math.max(lower, upper)) / 2;
    return { sets: 1, repsPerSet, totalReps: repsPerSet };
  }

  return null;
}

export function volumeOf(reps, weight) {
  const info = parseReps(reps);
  if (!info) return 0;
  const load = Number(weight);
  if (!Number.isFinite(load) || load <= 0) return 0;
  return info.totalReps * load;
}
