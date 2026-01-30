// ============================================================================
// UTILITAIRES CODES SH (héritage hiérarchique)
// ============================================================================

/**
 * Nettoie un code SH en supprimant les points, espaces et tirets
 */
export const cleanHSCode = (code: string): string => {
  return code.replace(/[\.\s\-]/g, "").trim();
};

/**
 * Formate un code SH avec les points de séparation standards
 */
export const formatHSCode = (code: string): string => {
  const clean = cleanHSCode(code);
  if (clean.length <= 2) return clean;
  if (clean.length <= 4) return clean.slice(0, 2) + "." + clean.slice(2);
  if (clean.length <= 6) return clean.slice(0, 4) + "." + clean.slice(4);
  if (clean.length <= 8) return clean.slice(0, 4) + "." + clean.slice(4, 6) + "." + clean.slice(6);
  return clean.slice(0, 4) + "." + clean.slice(4, 6) + "." + clean.slice(6, 8) + "." + clean.slice(8);
};

/**
 * Retourne les codes parents d'un code SH (pour l'héritage ascendant)
 */
export const getParentCodes = (code: string): string[] => {
  const clean = cleanHSCode(code);
  const parents: string[] = [];
  if (clean.length > 2) parents.push(clean.slice(0, 2));
  if (clean.length > 4) parents.push(clean.slice(0, 4));
  if (clean.length > 6) parents.push(clean.slice(0, 6));
  if (clean.length > 8) parents.push(clean.slice(0, 8));
  return parents;
};

/**
 * Détermine le niveau hiérarchique d'un code SH
 */
export const getHSLevel = (code: string): string => {
  const len = cleanHSCode(code).length;
  if (len <= 2) return "chapitre";
  if (len <= 4) return "position";
  if (len <= 6) return "sous-position";
  return "ligne_tarifaire";
};

/**
 * Échappe les caractères spéciaux pour les requêtes SQL LIKE/ILIKE
 */
export const escapeSearchTerm = (term: string): string => {
  return term
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
    .replace(/'/g, "''");
};
