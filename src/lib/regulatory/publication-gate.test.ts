import { describe, expect, it } from 'vitest';
import { publicationBlockers, type DocumentReview } from './publication-gate';

const valid: DocumentReview = {
  sourceVerified: true, reuseAuthorized: true,
  totalPages: 10, checkedPages: 10, failedPages: 0, unresolvedConflicts: 0,
  applicabilityReviewed: true, documentHash: 'a'.repeat(64),
  approvedHash: 'a'.repeat(64), reviewerId: 'reviewer-1',
};

describe('regulatory publication policy', () => {
  it('accepts a complete document approved at its current revision', () => {
    expect(publicationBlockers(valid)).toEqual([]);
  });
  it('blocks a silently skipped page', () => {
    expect(publicationBlockers({ ...valid, checkedPages: 9 })).toContain('incomplete_extraction');
  });
  it('invalidates approval when the source document changes', () => {
    expect(publicationBlockers({ ...valid, documentHash: 'b'.repeat(64) })).toContain('missing_or_stale_approval');
  });
  it('blocks unresolved regulatory conflicts despite human approval', () => {
    expect(publicationBlockers({ ...valid, unresolvedConflicts: 1 })).toContain('unresolved_conflicts');
  });
  it('blocks unlicensed sources and unreviewed applicability', () => {
    expect(publicationBlockers({ ...valid, reuseAuthorized: false, applicabilityReviewed: false }))
      .toEqual(['reuse_not_authorized', 'applicability_not_reviewed']);
  });
  it.each([NaN, -1, 1.5, Infinity])('rejects invalid page count %s', count => {
    expect(publicationBlockers({ ...valid, totalPages: count, checkedPages: count })).toContain('invalid_counts');
  });
});
