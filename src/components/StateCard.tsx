import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {colors} from '../theme/colors';

type Props = {
  title: string;
  message: string;
  tone?: 'default' | 'error';
};

export function StateCard({title, message, tone = 'default'}: Props) {
  return (
    <View style={styles.card}>
      <Text style={[styles.title, tone === 'error' && styles.error]}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.cardAlt,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 8,
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  error: {
    color: colors.danger,
  },
  message: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 22,
  },
});
