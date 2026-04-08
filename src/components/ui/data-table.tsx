import {
  type ColumnDef,
  type OnChangeFn,
  type PaginationState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import * as React from "react";
import { cn } from "../../lib/utils";
import { DataTablePagination } from "./data-table-pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table";

interface DataTableBaseProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];

  // Pagination
  pageSizeOptions?: number[];
  defaultPageSize?: number;
  pagination?: PaginationState;
  onPaginationChange?: OnChangeFn<PaginationState>;

  // Sorting
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;
  manualSorting?: boolean;

  // Column visibility
  initialColumnVisibility?: VisibilityState;

  // Styling & empty state
  className?: string;
  emptyMessage?: React.ReactNode;
}

type DataTableProps<TData, TValue> = DataTableBaseProps<TData, TValue> &
  (
    | {
        manualPagination: true;
        pageCount: number;
      }
    | {
        manualPagination?: false;
        pageCount?: number;
      }
  );

function DataTable<TData, TValue>({
  columns,
  data,
  pageSizeOptions,
  defaultPageSize = 20,
  pagination: controlledPagination,
  onPaginationChange: controlledOnPaginationChange,
  pageCount,
  manualPagination = false,
  sorting: controlledSorting,
  onSortingChange: controlledOnSortingChange,
  manualSorting = false,
  initialColumnVisibility,
  className,
  emptyMessage = "No results.",
}: DataTableProps<TData, TValue>) {
  const [internalSorting, setInternalSorting] = React.useState<SortingState>([]);
  const [internalPagination, setInternalPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: defaultPageSize,
  });
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>(
    initialColumnVisibility ?? {},
  );

  const isControlledSorting = controlledSorting !== undefined;
  const isControlledPagination = controlledPagination !== undefined;

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting: isControlledSorting ? controlledSorting : internalSorting,
      pagination: isControlledPagination ? controlledPagination : internalPagination,
      columnVisibility,
    },
    onSortingChange: isControlledSorting ? controlledOnSortingChange : setInternalSorting,
    onPaginationChange: isControlledPagination
      ? controlledOnPaginationChange
      : setInternalPagination,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: manualSorting ? undefined : getSortedRowModel(),
    getPaginationRowModel: manualPagination ? undefined : getPaginationRowModel(),
    manualSorting,
    manualPagination,
    pageCount,
  });

  const showPagination = table.getRowModel().rows.length > 0 && table.getPageCount() > 0;

  return (
    <div className={cn("space-y-4", className)}>
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id} colSpan={header.colSpan}>
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id} data-state={row.getIsSelected() ? "selected" : undefined}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center">
                {emptyMessage}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {showPagination ? (
        <DataTablePagination table={table} pageSizeOptions={pageSizeOptions} />
      ) : null}
    </div>
  );
}

export { DataTable };
export type { DataTableProps };
