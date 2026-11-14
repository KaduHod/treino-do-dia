const ROLE_LABELS = {
  agonist: 'Agonista',
  synergist: 'Sinergista',
  stabilizer: 'Estabilizador',
  antagonist: 'Antagonista',
};

export function roleLabel(role) {
  const key = String(role ?? '').toLowerCase();
  return ROLE_LABELS[key] ?? (role || '—');
}
