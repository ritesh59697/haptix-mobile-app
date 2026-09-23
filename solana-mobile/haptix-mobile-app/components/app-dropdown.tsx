import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import * as Dropdown from '@rn-primitives/dropdown-menu'
import { useAppTheme } from '@/components/theme/theme-context'
import { radius, typeScale } from '@/theme/tokens'

/**
 * Select control used by the settings sections.
 *
 * Restyled from the `@rn-primitives` template defaults (radius 5, a hardcoded
 * #1c1c1e surface, a second grey ramp) onto the app's own tokens, so the trigger
 * reads as another settings row instead of a form widget from a different app.
 * `label` is optional so the control still works as a bare value selector.
 */
export function AppDropdown({
  items,
  selectedItem,
  selectItem,
  label,
}: {
  items: readonly string[]
  selectedItem: string
  selectItem: (item: string) => void
  label?: string
}) {
  const { theme } = useAppTheme()

  return (
    <Dropdown.Root>
      <Dropdown.Trigger style={[styles.trigger, { backgroundColor: theme.bgInput, borderColor: theme.borderDefault }]}>
        <Text style={[styles.label, { color: theme.textSecondary }]}>{label ?? selectedItem}</Text>
        <View style={styles.valueGroup}>
          {label ? <Text style={[styles.value, { color: theme.textPrimary }]}>{selectedItem}</Text> : null}
          <MaterialIcons name="expand-more" size={18} color={theme.textMuted} />
        </View>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Overlay style={StyleSheet.absoluteFill}>
          {/* `Content` and `Item` type their style prop as a single object, so these
              are spread rather than passed as the arrays used elsewhere. */}
          <Dropdown.Content style={{ ...styles.list, backgroundColor: theme.bgCard, borderColor: theme.borderDefault }}>
            {items.map((item, index) => (
              <Dropdown.Item
                key={item}
                onPress={() => selectItem(item)}
                style={{
                  ...styles.item,
                  borderBottomColor: theme.borderSubtle,
                  borderBottomWidth: index < items.length - 1 ? 1 : 0,
                }}
              >
                <Text style={[styles.itemText, { color: theme.textPrimary }]}>{item}</Text>
                {item === selectedItem ? <MaterialIcons name="check" size={16} color={theme.accent} /> : null}
              </Dropdown.Item>
            ))}
          </Dropdown.Content>
        </Dropdown.Overlay>
      </Dropdown.Portal>
    </Dropdown.Root>
  )
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  label: {
    fontSize: typeScale.body,
    fontWeight: '500',
  },
  valueGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  value: {
    fontSize: typeScale.body,
    fontWeight: '600',
  },
  list: {
    borderRadius: radius.md,
    borderWidth: 1,
    marginTop: 8,
    overflow: 'hidden',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  itemText: {
    fontSize: typeScale.bodyLg,
    fontWeight: '500',
  },
})
