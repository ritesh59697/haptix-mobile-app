import React from 'react'
import { StyleSheet } from 'react-native'
import * as Dropdown from '@rn-primitives/dropdown-menu'
import { AppText } from '@/components/app-text'
import { useThemeColor } from '@/hooks/use-theme-color'

export function AppDropdown({
  items,
  selectedItem,
  selectItem,
}: {
  items: readonly string[]
  selectedItem: string
  selectItem: (item: string) => void
}) {
  const backgroundColor = useThemeColor({ light: '#ffffff', dark: '#1c1c1e' }, 'background')
  const borderColor = useThemeColor({ light: '#cccccc', dark: '#555555' }, 'border')
  const textColor = useThemeColor({ light: '#000000', dark: '#ffffff' }, 'text')

  return (
    <Dropdown.Root>
      <Dropdown.Trigger style={[styles.trigger, { backgroundColor, borderColor }]}>
        <AppText style={{ color: textColor }}>{selectedItem}</AppText>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Overlay style={StyleSheet.absoluteFill}>
          <Dropdown.Content style={{ ...styles.list, backgroundColor, borderColor }}>
            {items.map((item, index) => (
              <Dropdown.Item
                key={item}
                onPress={() => selectItem(item)}
                style={{
                  ...styles.item,
                  borderBottomColor: borderColor,
                  borderBottomWidth: index < items.length - 1 ? 1 : 0,
                }}
              >
                <AppText style={{ color: textColor }}>{item}</AppText>
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
    borderRadius: 5,
    borderWidth: 1,
    padding: 10,
  },
  list: {
    borderRadius: 5,
    borderWidth: 1,
    marginTop: 8,
  },
  item: {
    padding: 10,
  },
})
