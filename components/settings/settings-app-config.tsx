import { StyleSheet, Text } from 'react-native'
import { AppConfig } from '@/constants/app-config'
import { AppExternalLink, AppExternalLinkProps } from '@/components/app-external-link'
import { useAppTheme } from '@/components/theme/theme-context'
import { HaptixSettingsDivider, HaptixSettingsRow } from '@/components/haptix/haptix-settings-ui'
import { radius, typeScale } from '@/theme/tokens'

/**
 * App section body. Rows only — the settings screen owns the card and heading.
 *
 * The external link stays a real expo-router `Link` so the URI opens in the in-app
 * browser on native rather than bouncing the user out to the system browser, which
 * is what a raw `Linking.openURL` would do.
 */
export function SettingsAppConfig() {
  const { theme } = useAppTheme()

  return (
    <>
      <HaptixSettingsRow icon="apps" title={AppConfig.name} subtitle="Application name" />

      <HaptixSettingsDivider />

      <HaptixSettingsRow
        icon="link"
        title="Website"
        subtitle={AppConfig.uri}
        trailing={
          <AppExternalLink
            href={AppConfig.uri as AppExternalLinkProps['href']}
            style={[styles.linkAction, { backgroundColor: theme.accentLight, borderColor: theme.borderSubtle }]}
          >
            <Text style={[styles.linkActionText, { color: theme.textPrimary }]}>Open</Text>
          </AppExternalLink>
        }
      />
    </>
  )
}

const styles = StyleSheet.create({
  linkAction: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  linkActionText: {
    fontSize: typeScale.caption,
    fontWeight: '700',
  },
})
