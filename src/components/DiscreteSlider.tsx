import React, {useRef, useState} from 'react';
import {LayoutChangeEvent, PanResponder, Pressable, StyleSheet, Text, View} from 'react-native';
import {colors} from '../theme/colors';

const THUMB = 26;
const HIT_HEIGHT = 40;

type Props<T extends string> = {
  values: readonly T[];
  value: T;
  onChange: (value: T) => void;
  onChangeComplete?: (value: T) => void;
  onSlidingStart?: () => void;
  onSlidingEnd?: () => void;
  formatLabel?: (value: T) => string;
};

export function DiscreteSlider<T extends string>({
  values,
  value,
  onChange,
  onChangeComplete,
  onSlidingStart,
  onSlidingEnd,
  formatLabel = item => String(item),
}: Props<T>) {
  const [trackWidth, setTrackWidth] = useState(0);
  const widthRef = useRef(0);
  const pageXRef = useRef(0);
  const trackRef = useRef<View>(null);
  const indexRef = useRef(Math.max(0, values.indexOf(value)));
  const startIndexRef = useRef(indexRef.current);
  const valuesRef = useRef(values);
  const onChangeRef = useRef(onChange);
  const onCompleteRef = useRef(onChangeComplete);
  const onStartRef = useRef(onSlidingStart);
  const onEndRef = useRef(onSlidingEnd);

  valuesRef.current = values;
  onChangeRef.current = onChange;
  onCompleteRef.current = onChangeComplete;
  onStartRef.current = onSlidingStart;
  onEndRef.current = onSlidingEnd;
  indexRef.current = Math.max(0, values.indexOf(value));

  const indexFromPageX = (pageX: number) => {
    const n = valuesRef.current.length;
    const w = widthRef.current;
    if (n <= 1 || w <= 0) {
      return 0;
    }
    const x = Math.max(0, Math.min(w, pageX - pageXRef.current));
    return Math.round((x / w) * (n - 1));
  };

  const applyIndex = (next: number) => {
    if (next === indexRef.current) {
      return;
    }
    indexRef.current = next;
    onChangeRef.current(valuesRef.current[next]);
  };

  const finish = () => {
    onEndRef.current?.();
    if (indexRef.current !== startIndexRef.current) {
      onCompleteRef.current?.(valuesRef.current[indexRef.current]);
    }
  };

  const measureTrack = (after?: () => void) => {
    trackRef.current?.measureInWindow(x => {
      pageXRef.current = x;
      after?.();
    });
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: evt => {
        const pageX = evt.nativeEvent.pageX;
        startIndexRef.current = indexRef.current;
        onStartRef.current?.();
        measureTrack(() => applyIndex(indexFromPageX(pageX)));
      },
      onPanResponderMove: evt => {
        applyIndex(indexFromPageX(evt.nativeEvent.pageX));
      },
      onPanResponderRelease: finish,
      onPanResponderTerminate: finish,
    }),
  ).current;

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    widthRef.current = w;
    setTrackWidth(w);
    measureTrack();
  };

  const index = Math.max(0, values.indexOf(value));
  const last = Math.max(values.length - 1, 1);
  const step = trackWidth / last;
  const fillWidth = step * index;
  const thumbLeft = fillWidth - THUMB / 2;

  return (
    <View style={styles.wrap}>
      <View
        ref={trackRef}
        collapsable={false}
        style={styles.hit}
        onLayout={onLayout}
        {...pan.panHandlers}>
        <View style={styles.track}>
          <View style={[styles.fill, {width: Math.max(0, fillWidth)}]} />
        </View>
        {values.map((item, i) => (
          <View
            key={item}
            pointerEvents="none"
            style={[
              styles.tick,
              {left: step * i - 3.5},
              i <= index ? styles.tickActive : null,
            ]}
          />
        ))}
        <View pointerEvents="none" style={[styles.thumb, {left: thumbLeft}]} />
      </View>

      <View style={styles.labels}>
        {values.map((item, i) => {
          const isFirst = i === 0;
          const isLast = i === values.length - 1;
          const active = i === index;
          return (
            <Pressable
              key={item}
              onPress={() => {
                if (item !== value) {
                  onChange(item);
                  onChangeComplete?.(item);
                }
              }}
              style={[
                styles.labelHit,
                {
                  left: isFirst ? 0 : isLast ? undefined : step * i - 28,
                  right: isLast ? 0 : undefined,
                  width: 56,
                  alignItems: isFirst
                    ? 'flex-start'
                    : isLast
                      ? 'flex-end'
                      : 'center',
                },
              ]}
              hitSlop={6}
              accessibilityLabel={formatLabel(item)}
              accessibilityState={{selected: active}}>
              <Text style={[styles.label, active && styles.labelActive]}>
                {formatLabel(item)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 8,
  },
  hit: {
    height: HIT_HEIGHT,
    justifyContent: 'center',
  },
  track: {
    height: 6,
    borderRadius: 999,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  fill: {
    height: 6,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  tick: {
    position: 'absolute',
    top: (HIT_HEIGHT - 7) / 2,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.muted,
  },
  tickActive: {
    backgroundColor: colors.primary,
  },
  thumb: {
    position: 'absolute',
    top: (HIT_HEIGHT - THUMB) / 2,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: colors.primary,
    borderWidth: 3,
    borderColor: '#f3f7ff',
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 4,
    shadowOffset: {width: 0, height: 2},
  },
  labels: {
    height: 20,
    position: 'relative',
  },
  labelHit: {
    position: 'absolute',
    top: 0,
  },
  label: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '600',
  },
  labelActive: {
    color: colors.text,
  },
});
