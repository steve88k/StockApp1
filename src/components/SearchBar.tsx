import React from 'react';
import {Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {colors} from '../theme/colors';

type Props = {
  value: string;
  onChangeText: (value: string) => void;
  onSubmit: () => void;
  loading?: boolean;
};

export function SearchBar({value, onChangeText, onSubmit, loading = false}: Props) {
  return (
    <View style={styles.wrapper}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder="Enter a ticker symbol, e.g., AAPL"
        placeholderTextColor={colors.muted}
        autoCapitalize="characters"
        style={styles.input}
      />
      <Pressable onPress={onSubmit} disabled={loading} style={styles.button}>
        <Text style={styles.buttonText}>{loading ? 'Predicting...' : 'Search'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: 12,
  },
  input: {
    backgroundColor: colors.input,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  button: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
  },
  buttonText: {
    color: '#00152d',
    fontSize: 16,
    fontWeight: '700',
  },
});
