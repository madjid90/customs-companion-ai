-- Cover every foreign key introduced by the tariff evidence model so deletes,
-- lineage traversals and page-scoped quality checks remain predictable.

create index tariff_tables_block_idx on public.tariff_table_candidates(source_block_id) where source_block_id is not null;
create index tariff_rows_page_idx on public.tariff_row_candidates(source_page_id);
create index tariff_rows_parent_idx on public.tariff_row_candidates(parent_row_id) where parent_row_id is not null;
create index tariff_cells_page_idx on public.tariff_cell_evidence(source_page_id);
create index tariff_cells_block_idx on public.tariff_cell_evidence(source_block_id) where source_block_id is not null;

