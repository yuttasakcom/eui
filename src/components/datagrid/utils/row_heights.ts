/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0 and the Server Side Public License, v 1; you may not use this file except
 * in compliance with, at your election, the Elastic License 2.0 or the Server
 * Side Public License, v 1.
 */

import {
  CSSProperties,
  MutableRefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { GridOnItemsRenderedProps } from 'react-window';
import { useForceRender, useLatest } from '../../../services';
import { isNumber, isObject } from '../../../services/predicate';
import {
  EuiDataGridColumn,
  EuiDataGridRowHeightOption,
  EuiDataGridRowHeightsOptions,
  EuiDataGridScrollAnchorRow,
  EuiDataGridStyle,
  EuiDataGridStyleCellPaddings,
  ImperativeGridApi,
} from '../data_grid_types';
import { DataGridSortingContext } from './sorting';

// TODO: Once JS variables are available, use them here instead of hard-coded maps
export const cellPaddingsMap: Record<EuiDataGridStyleCellPaddings, number> = {
  s: 4,
  m: 6,
  l: 8,
};

export const AUTO_HEIGHT = 'auto';
export const DEFAULT_ROW_HEIGHT = 34;

export class RowHeightUtils {
  constructor(
    private gridRef: MutableRefObject<ImperativeGridApi | null>,
    private outerGridElementRef: MutableRefObject<HTMLDivElement | null>,
    private gridItemsRenderedRef: MutableRefObject<GridOnItemsRenderedProps | null>,
    private rerenderGridBodyRef: MutableRefObject<(() => void) | null>
  ) {}

  getRowHeightOption(
    rowIndex: number,
    rowHeightsOptions?: EuiDataGridRowHeightsOptions
  ): EuiDataGridRowHeightOption | undefined {
    return (
      rowHeightsOptions?.rowHeights?.[rowIndex] ??
      rowHeightsOptions?.defaultHeight
    );
  }

  isRowHeightOverride(
    rowIndex: number,
    rowHeightsOptions?: EuiDataGridRowHeightsOptions
  ): boolean {
    return rowHeightsOptions?.rowHeights?.[rowIndex] != null;
  }

  getCalculatedHeight(
    heightOption: EuiDataGridRowHeightOption,
    defaultHeight: number,
    rowIndex?: number,
    isRowHeightOverride?: boolean
  ) {
    if (isObject(heightOption) && heightOption.height) {
      return Math.max(heightOption.height, defaultHeight);
    }

    if (heightOption && isNumber(heightOption)) {
      return Math.max(heightOption, defaultHeight);
    }

    if (isObject(heightOption) && heightOption.lineCount) {
      if (isRowHeightOverride) {
        return this.getRowHeight(rowIndex!) || defaultHeight; // lineCount overrides are stored in the heights cache
      } else {
        return defaultHeight; // default lineCount height is set in minRowHeight state in grid_row_body
      }
    }

    if (heightOption === AUTO_HEIGHT && rowIndex != null) {
      return this.getRowHeight(rowIndex);
    }

    return defaultHeight;
  }

  /**
   * Styles utils
   */

  private styles: {
    paddingTop: number;
    paddingBottom: number;
  } = {
    paddingTop: 0,
    paddingBottom: 0,
  };

  cacheStyles(gridStyles: EuiDataGridStyle) {
    this.styles = {
      paddingTop: cellPaddingsMap[gridStyles.cellPadding || 'm'],
      paddingBottom: cellPaddingsMap[gridStyles.cellPadding || 'm'],
    };
  }

  getStylesForCell = (
    rowHeightsOptions: EuiDataGridRowHeightsOptions,
    rowIndex: number
  ): CSSProperties => {
    const height = this.getRowHeightOption(rowIndex, rowHeightsOptions);

    if (height === AUTO_HEIGHT) {
      return {};
    }

    const lineCount = this.getLineCount(height);
    if (lineCount) {
      return {
        WebkitLineClamp: lineCount,
        display: '-webkit-box',
        WebkitBoxOrient: 'vertical',
        height: '100%',
        overflow: 'hidden',
      };
    }

    return {
      height: '100%',
      overflow: 'hidden',
    };
  };

  /**
   * Line count utils
   */

  getLineCount(option?: EuiDataGridRowHeightOption) {
    return isObject(option) ? option.lineCount : undefined;
  }

  calculateHeightForLineCount(
    cellRef: HTMLElement,
    lineCount: number,
    excludePadding?: boolean
  ) {
    const computedStyles = window.getComputedStyle(cellRef, null);
    const lineHeight = parseInt(computedStyles.lineHeight, 10);
    const contentHeight = Math.ceil(lineCount * lineHeight);

    return excludePadding
      ? contentHeight
      : contentHeight + this.styles.paddingTop + this.styles.paddingBottom;
  }

  /**
   * Auto height utils
   */

  private heightsCache = new Map<number, Map<string, number>>();
  private timerId?: number;
  private lastUpdatedRow: number = Infinity;

  isAutoHeight(
    rowIndex: number,
    rowHeightsOptions?: EuiDataGridRowHeightsOptions
  ) {
    const height = this.getRowHeightOption(rowIndex, rowHeightsOptions);

    if (height === AUTO_HEIGHT) {
      return true;
    }
    return false;
  }

  getRowHeight(rowIndex: number) {
    const rowHeights = this.heightsCache.get(rowIndex);
    if (rowHeights == null) return 0;

    const rowHeightValues = Array.from(rowHeights.values());
    if (!rowHeightValues.length) return 0;

    return Math.max(...rowHeightValues);
  }

  setRowHeight(
    rowIndex: number,
    colId: string,
    height: number = DEFAULT_ROW_HEIGHT,
    visibleRowIndex: number
  ) {
    const rowHeights =
      this.heightsCache.get(rowIndex) || new Map<string, number>();
    const adaptedHeight = Math.ceil(
      height + this.styles.paddingTop + this.styles.paddingBottom
    );

    if (rowHeights.get(colId) === adaptedHeight) {
      return;
    }

    rowHeights.set(colId, adaptedHeight);
    this.heightsCache.set(rowIndex, rowHeights);
    this.resetRow(visibleRowIndex);

    // When an auto row height is updated, force a re-render
    // of the grid body to update the unconstrained height
    this.rerenderGridBodyRef.current?.();
  }

  pruneHiddenColumnHeights(visibleColumns: EuiDataGridColumn[]) {
    const visibleColumnIds = new Set(visibleColumns.map(({ id }) => id));
    let didModify = false;

    this.heightsCache.forEach((rowHeights) => {
      const existingColumnIds = Array.from(rowHeights.keys());
      existingColumnIds.forEach((existingColumnId) => {
        if (visibleColumnIds.has(existingColumnId) === false) {
          didModify = true;
          rowHeights.delete(existingColumnId);
        }
      });
    });

    if (didModify) {
      this.resetRow(0);
    }
  }

  resetRow(visibleRowIndex: number) {
    // save the first row index of batch, reassigning it only
    // if this visible row index less than lastUpdatedRow
    this.lastUpdatedRow = Math.min(this.lastUpdatedRow, visibleRowIndex);
    clearTimeout(this.timerId);
    this.timerId = window.setTimeout(() => this.resetGrid(), 0);
  }

  resetGrid() {
    this.gridRef.current?.resetAfterRowIndex(this.lastUpdatedRow);
    this.lastUpdatedRow = Infinity;
  }

  compensateForLayoutShift(
    rowIndex: number,
    verticalLayoutShift: number,
    anchorRow: EuiDataGridScrollAnchorRow
  ) {
    const grid = this.gridRef.current;
    const outerGridElement = this.outerGridElementRef.current;
    const renderedItems = this.gridItemsRenderedRef.current;

    if (
      grid == null ||
      outerGridElement == null ||
      renderedItems == null ||
      anchorRow == null ||
      !Number.isFinite(verticalLayoutShift)
    ) {
      return;
    }

    // skip if the start row is the anchor row but it hasn't shifted
    if (
      anchorRow === 'start' &&
      renderedItems.visibleRowStartIndex !== rowIndex
    ) {
      return;
    }

    // skip if the center row is the anchor row but it hasn't shifted
    if (
      anchorRow === 'center' &&
      Math.floor(
        (renderedItems.visibleRowStopIndex -
          renderedItems.visibleRowStartIndex) /
          2
      ) !== rowIndex
    ) {
      return;
    }

    grid.scrollTo({
      scrollTop: outerGridElement.scrollTop + verticalLayoutShift,
    });
  }
}

/**
 * Hook for instantiating RowHeightUtils, setting internal class vars,
 * and setting up various row-height-related side effects
 */
export const useRowHeightUtils = ({
  gridRef,
  outerGridElementRef,
  gridItemsRenderedRef,
  gridStyles,
  columns,
  rowHeightsOptions,
}: {
  gridRef: MutableRefObject<ImperativeGridApi | null>;
  outerGridElementRef: MutableRefObject<HTMLDivElement | null>;
  gridItemsRenderedRef: MutableRefObject<GridOnItemsRenderedProps | null>;
  gridStyles: EuiDataGridStyle;
  columns: EuiDataGridColumn[];
  rowHeightsOptions?: EuiDataGridRowHeightsOptions;
}) => {
  const forceRenderRef = useLatest(useForceRender());
  const [rowHeightUtils] = useState(
    () =>
      new RowHeightUtils(
        gridRef,
        outerGridElementRef,
        gridItemsRenderedRef,
        forceRenderRef
      )
  );

  // Forces a rerender whenever the row heights change, as this can cause the
  // grid to change height/have scrollbars. Without this, grid rerendering is stale
  useEffect(() => {
    if (forceRenderRef.current == null) {
      return;
    }

    requestAnimationFrame(forceRenderRef.current);
  }, [
    // Effects that should cause rerendering
    rowHeightsOptions?.defaultHeight,
    rowHeightsOptions?.rowHeights,
    // Dependencies
    rowHeightUtils,
    forceRenderRef,
  ]);

  // Re-cache styles whenever grid density changes
  useEffect(() => {
    rowHeightUtils.cacheStyles({
      cellPadding: gridStyles.cellPadding,
    });
  }, [gridStyles.cellPadding, rowHeightUtils]);

  // Update row heights map to remove hidden columns whenever orderedVisibleColumns change
  useEffect(() => {
    rowHeightUtils.pruneHiddenColumnHeights(columns);
  }, [rowHeightUtils, columns]);

  return rowHeightUtils;
};

export const useDefaultRowHeight = ({
  rowHeightsOptions,
  rowHeightUtils,
}: {
  rowHeightsOptions?: EuiDataGridRowHeightsOptions;
  rowHeightUtils: RowHeightUtils;
}) => {
  const { getCorrectRowIndex } = useContext(DataGridSortingContext);

  // `minRowHeight` is primarily used by undefined & lineCount heights
  // and ignored by auto & static heights (unless the static height is < the min)
  const [minRowHeight, setRowHeight] = useState(DEFAULT_ROW_HEIGHT);

  // Default/fallback height for all rows
  const defaultRowHeight = useMemo(() => {
    return rowHeightsOptions?.defaultHeight
      ? rowHeightUtils.getCalculatedHeight(
          rowHeightsOptions.defaultHeight,
          minRowHeight
        )
      : minRowHeight;
  }, [rowHeightsOptions, minRowHeight, rowHeightUtils]);

  // Used by react-window's Grid component to determine actual row heights
  const getRowHeight = useCallback(
    (rowIndex: number) => {
      const correctRowIndex = getCorrectRowIndex(rowIndex);
      let rowHeight;

      // Account for row-specific height overrides
      const rowHeightOption = rowHeightUtils.getRowHeightOption(
        correctRowIndex,
        rowHeightsOptions
      );
      if (rowHeightOption) {
        rowHeight = rowHeightUtils.getCalculatedHeight(
          rowHeightOption,
          minRowHeight,
          correctRowIndex,
          rowHeightUtils.isRowHeightOverride(correctRowIndex, rowHeightsOptions)
        );
      }

      // Use the row-specific height if it exists, if not, fall back to the default
      return rowHeight || defaultRowHeight;
    },
    [
      minRowHeight,
      rowHeightsOptions,
      getCorrectRowIndex,
      rowHeightUtils,
      defaultRowHeight,
    ]
  );

  return { defaultRowHeight, setRowHeight, getRowHeight };
};
