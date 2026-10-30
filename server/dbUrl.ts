// Postgres manzilini tozalash (sof funksiya — sozlamalar yuklanmasdan test qilinadi).

/**
 * Neon'ning "Connect" oynasidan ko'pincha `psql 'postgresql://...'` ko'rinishida yoki qo'shtirnoq bilan nusxalanadi —
 * ichidan faqat manzilning o'zini olamiz.
 */
export function cleanDatabaseUrl(raw: string): string | null {
  const m = /postgres(?:ql)?:\/\/[^\s'"`]+/.exec(raw);
  return m ? m[0] : null;
}
