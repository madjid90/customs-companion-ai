/** Publication policy for the future ingestion worker. Not yet wired to production. */
export interface DocumentReview {
  sourceVerified: boolean;
  reuseAuthorized: boolean;
  totalPages: number;
  checkedPages: number;
  failedPages: number;
  unresolvedConflicts: number;
  applicabilityReviewed: boolean;
  documentHash: string;
  approvedHash: string | null;
  reviewerId: string | null;
}

export function publicationBlockers(review: DocumentReview): string[] {
  const blockers: string[] = [];
  if (!review.sourceVerified) blockers.push('unverified_source');
  if (!review.reuseAuthorized) blockers.push('reuse_not_authorized');
  const counts = [review.totalPages, review.checkedPages, review.failedPages, review.unresolvedConflicts];
  if (counts.some(n => !Number.isSafeInteger(n) || n < 0)) blockers.push('invalid_counts');
  if (review.totalPages < 1 || review.checkedPages !== review.totalPages || review.failedPages !== 0) {
    blockers.push('incomplete_extraction');
  }
  if (review.unresolvedConflicts !== 0) blockers.push('unresolved_conflicts');
  if (!review.applicabilityReviewed) blockers.push('applicability_not_reviewed');
  if (!review.reviewerId?.trim() || !/^[a-f0-9]{64}$/i.test(review.documentHash) || review.approvedHash !== review.documentHash) {
    blockers.push('missing_or_stale_approval');
  }
  return blockers;
}
