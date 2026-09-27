import { StyleSheet, Text } from 'react-native'
import { AppConfig } from '@/constants/app-config'
import { AppExternalLink, AppExternalLinkProps } from '@/components/app-external-link'
import { useAppTheme } from '@/components/theme/theme-context'
import { HaptixSettingsBadge, HaptixSettingsDivider, HaptixSettingsRow } from '@/components/haptix/haptix-settings-ui'
import { radius, typeScale } from '@/theme/tokens'

/**
 * App section body. Rows only — the settings screen owns the card and heading.
 */
export function SettingsAppConfig() {
  const { theme } = useAppTheme()

  return (
    <>
      <HaptixSettingsRow
        icon="apps"
        title={AppConfig.name}
        subtitle="Version 1.0.0 • Solana Mobile Stack"
        trailing={<HaptixSettingsBadge label="v1.0.0" tone="muted" />}
      />

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

      <HaptixSettingsDivider />

      <HaptixSettingsRow
        icon="code"
        title="Source & Documentation"
        subtitle="GitHub / Solana Mobile Hackathon"
        trailing={
          <AppExternalLink
            href="https://github.com/ritesh59697/haptix-mobile-app"
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
