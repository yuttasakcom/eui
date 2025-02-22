/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0 and the Server Side Public License, v 1; you may not use this file except
 * in compliance with, at your election, the Elastic License 2.0 or the Server
 * Side Public License, v 1.
 */

import React, {
  FunctionComponent,
  useState,
  useMemo,
  useEffect,
  MouseEventHandler,
  HTMLAttributes,
  ReactNode,
} from 'react';

import range from 'lodash/range';

import { useEuiTheme, isEvenlyDivisibleBy } from '../../../services';

import { EuiRangeLevels } from './range_levels';
import { EuiRangeTicks } from './range_ticks';
import type {
  _SharedRangesValues,
  _SharedRangeDataStructures,
  _SharedRangeVisualConfiguration,
  _SharedRangeInputProps,
} from './types';

import { euiRangeTrackStyles } from './range_track.styles';

export interface EuiRangeTrackProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'>,
    _SharedRangesValues,
    _SharedRangeDataStructures,
    Pick<_SharedRangeVisualConfiguration, 'showTicks' | 'showRange'>,
    Pick<_SharedRangeInputProps, 'compressed' | 'disabled'> {
  onChange?: MouseEventHandler<HTMLButtonElement>;
  children?: ReactNode | ((trackWidth: number) => React.ReactNode);
}

export const EuiRangeTrack: FunctionComponent<EuiRangeTrackProps> = ({
  children,
  disabled,
  max,
  min,
  step,
  showTicks,
  tickInterval,
  ticks,
  levels,
  onChange,
  value,
  compressed,
  showRange,
  ...rest
}) => {
  useEffect(() => {
    validateValueIsInStep(max, { min, max, step });
  }, [value, min, max, step]);

  const tickSequence: number[] | undefined = useMemo(() => {
    if (showTicks !== true) return;

    let sequence;

    if (ticks) {
      // If custom values were passed, use those for the sequence
      // But make sure they align with the possible sequence
      sequence = ticks.map((tick) => {
        return validateValueIsInStep(tick.value, { min, max, step });
      });
    } else {
      // If a custom interval was passed, use those for the sequence
      // But make sure they align with the possible sequence
      const interval = tickInterval || step;

      // Calculate sequence - loop from min to max, creating adding values at each interval
      const sequenceRange = range(min, max, interval);
      // range is non-inclusive of max, so make it inclusive
      if (max % interval! === 0 && !sequenceRange.includes(max)) {
        sequenceRange.push(max);
      }

      sequence = sequenceRange.map((tick) => {
        return validateValueIsInStep(tick, { min, max, step });
      });
    }

    // Error out if there are too many ticks to render
    if (sequence.length > 20) {
      throw new Error(
        `The number of ticks to render is too high (${sequence.length}), reduce the interval.`
      );
    }

    return sequence;
  }, [showTicks, ticks, min, max, tickInterval, step]);

  const euiTheme = useEuiTheme();
  const styles = euiRangeTrackStyles(euiTheme);
  const cssStyles = [
    styles.euiRangeTrack,
    disabled && styles.disabled,
    levels && !!levels.length && styles.hasLevels,
    (tickSequence || ticks) && styles.hasTicks,
  ];

  const [trackWidth, setTrackWidth] = useState(0);

  return (
    <div
      className="euiRangeTrack"
      css={cssStyles}
      {...rest}
      ref={(node: HTMLDivElement | null) => {
        setTrackWidth(node?.clientWidth ?? 0);
      }}
    >
      {levels && !!levels.length && (
        <EuiRangeLevels
          levels={levels}
          max={max}
          min={min}
          showTicks={showTicks}
          showRange={showRange}
          trackWidth={trackWidth}
        />
      )}
      {tickSequence && (
        <EuiRangeTicks
          disabled={disabled}
          compressed={compressed}
          onChange={onChange}
          ticks={ticks}
          tickInterval={tickInterval || step}
          tickSequence={tickSequence}
          value={value}
          min={min}
          max={max}
          trackWidth={trackWidth}
        />
      )}
      {typeof children === 'function' ? children(trackWidth) : children}
    </div>
  );
};

const validateValueIsInStep = (
  value: number,
  { min, max, step }: Pick<EuiRangeTrackProps, 'min' | 'max' | 'step'>
) => {
  if (value < min) {
    throw new Error(
      `The value of ${value} is lower than the min value of ${min}.`
    );
  }
  if (value > max) {
    throw new Error(
      `The value of ${value} is higher than the max value of ${max}.`
    );
  }
  // Error out if the value doesn't line up with the sequence of steps
  if (!isEvenlyDivisibleBy(value - min, step !== undefined ? step : 1)) {
    throw new Error(
      `The value of ${value} is not included in the possible sequence provided by the step of ${step}.`
    );
  }
  // Return the value if nothing fails
  return value;
};
