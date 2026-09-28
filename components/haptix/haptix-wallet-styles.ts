import { useMemo } from 'react'
import { Platform, StyleSheet } from 'react-native'
import { useAppTheme } from '@/components/theme/theme-context'
import { radius, space, typeScale, ThemeTokens } from '@/theme/tokens'

/**
 * The wallet screen's style sheet, in its own module.
 *
 * The activity and agent rows are now separate, memoized components
 * (`haptix-wallet-rows.tsx`) so a price tick or a session countdown repaints one row
 * instead of the whole screen -- but they dress themselves in the same sheet as the
 * screen around them. Keeping the sheet in `haptix-wallet-screen.tsx` would have made
 * the two modules import each other, so the sheet moved down a level and both import
 * it from here.
 */

// Cards previously used three different horizontal insets (hero card 18, asset and
// activity lists 16, empty state 24), so their inner text columns did not line up
// down the page. Every card now shares this inset.
const CARD_PADDING_X = 18

// The four header controls (avatar, network chip, theme toggle, overflow menu) were
// 36/27/32/34dp tall with three different radii, which read as four unrelated chips
// rather than one control group. They all use this size now.
const HEADER_CONTROL_SIZE = 36

// Status labels, tappable chips and mini stat tiles each get exactly one
// geometry. This family previously carried eleven hand-tuned padding pairs
// (vertical 2/3/4/5/6/7/8 against horizontal 6/7/8/9/10/12/14, spread over
// radii sm/md/xl), so two badges sitting in the same row never lined up, and
// "the same" tag looked different on the agents page than on the home page.
const TAG_SHAPE = {
  paddingHorizontal: space.sm,
  paddingVertical: space.xs,
  borderRadius: radius.pill,
} as const

const CHIP_SHAPE = {
  paddingHorizontal: space.md,
  paddingVertical: space.sm,
  borderRadius: radius.pill,
} as const

const TILE_SHAPE = {
  paddingHorizontal: space.md,
  paddingVertical: space.sm,
  borderRadius: radius.lg,
} as const

// This sheet is built per theme rather than declared once at module scope.
// The screen used to carry a second, Tailwind-ish palette inline (25 copies of
// #10B981, 21 of #FDA4AF, 33 rgba() tints) purely because a module-level
// StyleSheet.create cannot read the active theme -- and those hand-picked values
// were dark-only, so light mode rendered #FFFBEB and #ECFDF5 washes on white.
// Every colour below now resolves through theme/tokens.ts.
const createStyles = (theme: ThemeTokens) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.bgApp,
    },

    /* 1. ELEVATED CONSUMER HEADER */
    header: {
      backgroundColor: theme.bgApp,
      borderBottomWidth: 0,
      paddingHorizontal: 16,
      paddingTop: 4,
      paddingBottom: 10,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      maxWidth: 440,
      width: '100%',
      alignSelf: 'center',
    },
    headerLeftGroup: {
      flexDirection: 'column',
      gap: 2,
      flexShrink: 1,
    },
    avatarButton: {
      justifyContent: 'center',
      alignItems: 'center',
    },
    avatarCircle: {
      width: 40,
      height: 40,
      borderRadius: 20,
      borderWidth: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    avatarCircleAlert: {
      borderColor: theme.roseBorder,
      backgroundColor: theme.roseBg,
    },
    identityTextGroup: {
      justifyContent: 'center',
    },
    accountSwitcherTrigger: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      flexShrink: 1,
    },
    headerWalletName: {
      fontSize: 18,
      fontWeight: '700',
      letterSpacing: -0.3,
      maxWidth: 240,
    },
    headerSubRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 2,
    },
    addressCopyChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      alignSelf: 'flex-start',
    },
    addressCopyText: {
      fontSize: 13,
      fontWeight: '500',
    },
    headerNetworkText: {
      fontSize: 13,
      fontWeight: '500',
    },
    headerRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    networkPill: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      height: HEADER_CONTROL_SIZE,
      borderWidth: 1,
      paddingHorizontal: 10,
      borderRadius: radius.md,
    },
    networkDot: {
      width: 6,
      height: 6,
      borderRadius: radius.pill,
      backgroundColor: theme.amber,
    },
    networkPillText: {
      fontSize: typeScale.caption,
      fontWeight: '600',
    },
    headerIconBtn: {
      width: HEADER_CONTROL_SIZE,
      height: HEADER_CONTROL_SIZE,
      borderRadius: radius.md,
      borderWidth: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    headerIconBtnAlert: {
      borderColor: theme.roseBorder,
      backgroundColor: theme.roseBg,
    },

    /* EMERGENCY FREEZE BANNER */
    freezeAlertBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: theme.roseBg,
      borderBottomWidth: 1,
      borderBottomColor: theme.roseBorder,
      paddingHorizontal: 20,
      paddingVertical: 8,
    },
    freezeAlertText: {
      color: theme.roseText,
      fontSize: typeScale.caption,
      fontWeight: '700',
      letterSpacing: 0.5,
    },
    freezeAlertAction: {
      color: theme.roseText,
      fontSize: typeScale.footnote,
      fontWeight: '600',
      textDecorationLine: 'underline',
    },

    /* 2. DASHBOARD SCROLL & SPACING */
    scrollArea: {
      flex: 1,
    },
    scrollContent: {
      paddingHorizontal: 16,
      paddingTop: 8,
    },
    dashboardContainer: {
      maxWidth: 440,
      width: '100%',
      alignSelf: 'center',
    },

    /* DEDICATED PAGE HEADER */
    pageHeader: {
      marginBottom: 16,
      paddingHorizontal: 2,
      marginTop: 4,
    },
    pageTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    pageTitle: {
      fontSize: typeScale.display,
      fontWeight: '700',
      letterSpacing: -0.4,
    },
    pageSubtitle: {
      fontSize: typeScale.body,
      lineHeight: 18,
      marginTop: 4,
    },
    policyLink: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 9,
      paddingVertical: 5,
      borderRadius: radius.pill,
      borderWidth: 1,
    },
    policyLinkText: {
      fontSize: typeScale.caption,
      fontWeight: '600',
    },

    /* HERO BALANCE CARD */
    heroCard: {
      borderRadius: 32,
      paddingHorizontal: 24,
      paddingVertical: 26,
      marginBottom: 20,
      backgroundColor: '#0A0A0A',
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: theme.isDark ? 0.3 : 0.05,
      shadowRadius: 24,
      elevation: 8,
      borderWidth: theme.isDark ? 1 : 0,
      borderColor: theme.isDark ? 'rgba(255,255,255,0.06)' : 'transparent',
    },
    heroBalanceLabelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 8,
    },
    heroBalanceLabel: {
      fontSize: 14,
      fontWeight: '500',
    },
    eyeToggleButton: {
      padding: 2,
      justifyContent: 'center',
      alignItems: 'center',
    },
    heroBalanceContent: {
      marginBottom: 16,
    },
    balanceSkeletonContainer: {
      gap: 8,
      paddingVertical: 4,
    },
    balanceSkeletonLarge: {
      width: 170,
      height: 38,
      borderRadius: radius.md,
    },
    balanceSkeletonSmall: {
      width: 110,
      height: 18,
      borderRadius: radius.sm,
    },
    heroPrimaryBalance: {
      fontSize: 48,
      fontWeight: '800',
      letterSpacing: -1.6,
    },
    heroSecondaryBalance: {
      fontSize: 14,
      fontWeight: '500',
    },
    heroActionsRow: {
      flexDirection: 'row',
      justifyContent: 'space-evenly',
      marginTop: 24,
    },
    heroActionBtn: {
      flex: 1,
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 10,
    },
    actionIconContainer: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: theme.isDark ? '#000000' : '#FFFFFF',
      borderWidth: theme.isDark ? 1 : 0,
      borderColor: theme.isDark ? '#2C2C2E' : 'transparent',
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: theme.isDark ? 0 : 0.08,
      shadowRadius: 12,
      elevation: 4,
      justifyContent: 'center',
      alignItems: 'center',
    },
    heroActionBtnText: {
      fontSize: 13,
      fontWeight: '700',
      letterSpacing: 0.1,
      color: theme.isDark ? '#FFFFFF' : '#000000',
    },
    /* HOME TAB SEGMENTED PILL (Assets · Watchlist) */
    homeTabContainer: {
      flexDirection: 'row',
      backgroundColor: theme.isDark ? '#0C0C0E' : '#F2F2F4',
      borderRadius: radius.pill,
      padding: 4,
      marginTop: 8,
      marginBottom: 20,
      height: 48,
    },
    homeTabPill: {
      flex: 1,
      height: '100%',
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    homeTabPillActive: {
      backgroundColor: theme.accent,
    },
    homeTabPillText: {
      fontSize: 15,
      fontWeight: '600',
    },
    homeTabPillTextActive: {
      color: '#FFFFFF',
    },
    homeTabPillTextInactive: {
      color: theme.textSecondary,
    },
    /* QUICK ACTIONS GRID */
    quickActionsGrid: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 14,
    },
    /* SEGMENTED FILTER BAR */
    segmentedContainer: {
      marginBottom: 14,
    },

    segmentNote: {
      fontSize: typeScale.footnote,
      fontWeight: '500',
      marginTop: -6,
      marginBottom: 10,
      marginLeft: 2,
    },

    panicExplain: {
      fontSize: typeScale.body,
      lineHeight: 19,
      marginBottom: 14,
    },

    homeSectionHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 2,
      marginTop: 16,
      marginBottom: 10,
    },

    homeSectionTitle: {
      fontSize: 18,
      fontWeight: '700',
      letterSpacing: -0.3,
    },

    homeSectionLink: {
      fontSize: 14,
      fontWeight: '500',
    },

    /* TREND BADGE */
    trendBadge: { ...TAG_SHAPE, backgroundColor: theme.accentLight },
    trendBadgeText: {
      fontSize: typeScale.caption,
      fontWeight: '600',
      letterSpacing: 0.1,
    },
    trendPositive: {
      color: theme.emeraldText,
    },
    trendNegative: {
      color: theme.roseText,
    },

    /* CLEAN DESIGN SYSTEM (Agency-grade, minimal, single accent #6c8cff) */
    cleanHeaderContainer: {
      paddingHorizontal: 20,
      paddingBottom: 2,
    },
    cleanHeaderTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 3,
    },
    cleanAccountTrigger: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    cleanAccountName: {
      fontSize: 15,
      fontWeight: '500',
      color: theme.textPrimary,
    },
    cleanHeaderSubtitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 16,
    },
    cleanAddressChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    cleanAddressText: {
      fontSize: 12,
      color: theme.textMuted,
    },
    cleanNetworkText: {
      fontSize: 12,
      color: theme.textMuted,
      marginLeft: 4,
    },

    cleanBalanceSection: {
      position: 'relative',
      borderRadius: 16,
      paddingHorizontal: 16,
      paddingVertical: 18,
      marginBottom: 18,
      overflow: 'hidden',
      backgroundColor: theme.isDark ? '#000000' : theme.bgElevated,
      borderWidth: 0.5,
      borderColor: theme.isDark ? '#222226' : theme.borderDefault,
    },
    cleanBalanceLabelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 6,
    },
    cleanBalanceLabel: {
      fontSize: 12,
      color: '#8a8985',
    },
    cleanBalanceValue: {
      fontSize: 38,
      fontWeight: '500',
      letterSpacing: -0.8,
      color: theme.textPrimary,
    },
    cleanBalanceChange: {
      fontSize: 12.5,
      marginTop: 4,
      color: '#5fbf7a',
      fontWeight: '400',
    },

    cleanActionsGrid: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 24,
    },
    cleanPrimaryActionCard: {
      flex: 1,
      backgroundColor: '#6c8cff',
      borderRadius: 12,
      paddingVertical: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cleanPrimaryActionLabel: {
      fontSize: 12,
      marginTop: 6,
      color: '#0c0c0d',
      fontWeight: '500',
    },
    cleanActionCard: {
      flex: 1,
      borderWidth: 0.5,
      borderColor: '#2a2a28',
      borderRadius: 12,
      paddingVertical: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
    },
    cleanActionLabel: {
      fontSize: 12,
      marginTop: 6,
      color: theme.textPrimary,
      fontWeight: '400',
    },

    cleanTabsRow: {
      flexDirection: 'row',
      gap: 18,
      borderBottomWidth: 0.5,
      borderBottomColor: '#2a2a28',
      marginBottom: 12,
    },
    cleanTabBtn: {
      paddingBottom: 8,
      borderBottomWidth: 2,
      borderBottomColor: 'transparent',
    },
    cleanTabBtnActive: {
      borderBottomColor: theme.accent,
    },
    cleanTabText: {
      fontSize: 13.5,
      fontWeight: '400',
      color: theme.textMuted,
    },
    cleanTabTextActive: {
      color: theme.textPrimary,
      fontWeight: '500',
    },

    cleanAssetRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 10,
      borderBottomWidth: 0.5,
      borderBottomColor: '#201f1d',
    },
    cleanAssetLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    cleanAssetLogoDisk: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: '#201f1d',
      alignItems: 'center',
      justifyContent: 'center',
    },
    cleanAssetName: {
      fontSize: 13.5,
      fontWeight: '500',
      color: theme.textPrimary,
    },
    cleanAssetTicker: {
      fontSize: 11.5,
      color: '#8a8985',
      marginTop: 1,
    },
    cleanAssetRight: {
      alignItems: 'flex-end',
    },
    cleanAssetAmount: {
      fontSize: 13,
      fontWeight: '500',
      color: theme.textPrimary,
    },
    cleanAssetFiatRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 6,
      marginTop: 1,
    },
    cleanAssetFiat: {
      fontSize: 11.5,
      color: '#8a8985',
    },
    cleanAssetChangePct: {
      fontSize: 11.5,
    },

    cleanActivityHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 20,
      marginBottom: 10,
    },
    cleanActivityTitle: {
      fontSize: 14,
      fontWeight: '500',
      color: theme.textPrimary,
    },
    cleanActivitySeeAll: {
      fontSize: 12,
      color: theme.accent,
      fontWeight: '500',
    },
    cleanActivityRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 8,
      gap: 10,
    },

    /* ASSETS LIST (CLEAN LIST WITHOUT CARD CLUTTER) */
    assetList: {
      paddingHorizontal: 12,
      paddingBottom: 24,
    },
    assetRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 16,
    },
    assetLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    assetLogoWrap: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: theme.isDark ? '#1C1C1E' : '#F5F5F7',
      justifyContent: 'center',
      alignItems: 'center',
    },
    assetPrimaryName: {
      fontSize: 17,
      fontWeight: '700',
      letterSpacing: -0.2,
    },
    assetSecondaryTag: {
      fontSize: 13,
      fontWeight: '500',
      marginTop: 2,
    },
    assetRight: {
      alignItems: 'flex-end',
    },
    assetCryptoAmount: {
      fontSize: 16,
      fontWeight: '700',
      letterSpacing: -0.2,
    },
    assetFiatAmount: {
      fontSize: 13,
      fontWeight: '500',
    },
    assetDivider: {
      height: 1,
    },

    /* AI AGENTS STYLES */
    agentHeroCard: {
      borderWidth: 1,
      borderRadius: radius.lg,
      padding: 16,
      marginBottom: 14,
    },
    agentHeroHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 14,
    },
    agentFirewallIconCircle: {
      width: 36,
      height: 36,
      borderRadius: radius.pill,
      justifyContent: 'center',
      alignItems: 'center',
    },
    agentHeroTitle: {
      fontSize: typeScale.title,
      fontWeight: '700',
      letterSpacing: -0.2,
    },
    agentHeroSubtitle: {
      fontSize: typeScale.footnote,
      marginTop: 1,
    },
    agentHeroStatusBadge: {
      ...TAG_SHAPE,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
      borderWidth: 1,
    },
    agentStatusDot: {
      width: 6,
      height: 6,
      borderRadius: radius.pill,
    },
    agentStatusText: {
      fontSize: typeScale.footnote,
      fontWeight: '600',
    },
    agentBudgetStatRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      marginBottom: 8,
    },
    agentBudgetLabel: {
      fontSize: typeScale.footnote,
      fontWeight: '500',
    },
    agentBudgetNumber: {
      fontSize: typeScale.displaySm,
      fontWeight: '700',
      marginTop: 2,
      letterSpacing: -0.3,
    },
    agentProgressTrack: {
      height: 6,
      borderRadius: radius.pill,
      overflow: 'hidden',
      marginBottom: 12,
    },
    agentProgressFill: {
      height: '100%',
      borderRadius: radius.pill,
    },
    agentPolicyPillRow: {
      flexDirection: 'row',
      gap: space.sm,
    },
    agentPolicyPill: {
      ...TILE_SHAPE,
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      borderWidth: 1,
    },
    agentPolicyPillText: {
      fontSize: typeScale.caption,
      fontWeight: '600',
      flexShrink: 1,
    },
    agentSectionCard: {
      borderWidth: 1,
      borderRadius: radius.lg,
      padding: 16,
      marginBottom: 14,
    },
    agentSectionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 12,
    },
    agentSectionHeading: {
      fontSize: typeScale.title,
      fontWeight: '700',
      letterSpacing: -0.2,
    },
    agentCompactRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 4,
    },
    agentCompactIcon: {
      width: 36,
      height: 36,
      borderRadius: radius.md,
      borderWidth: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    agentCompactName: {
      fontSize: typeScale.bodyLg,
      fontWeight: '600',
    },
    agentCompactSub: {
      fontSize: typeScale.footnote,
      marginTop: 2,
    },
    agentRevokeBtn: {
      ...CHIP_SHAPE,
      borderWidth: 1,
      minWidth: 64,
      alignItems: 'center',
      justifyContent: 'center',
    },
    agentRevokeBtnText: {
      color: theme.roseText,
      fontSize: typeScale.caption,
      fontWeight: '700',
    },
    agentRowDivider: {
      height: 1,
      marginVertical: 10,
    },
    quorumBadgeSmall: {
      ...TAG_SHAPE,
      borderWidth: 1,
    },
    agentChipSelectorRow: {
      flexDirection: 'row',
      gap: space.sm,
      width: '100%',
    },
    agentRecipientInput: {
      height: 48,
      borderWidth: 1,
      borderRadius: radius.md,
      paddingHorizontal: 14,
      fontSize: 14,
    },
    agentRecipientHint: {
      fontSize: 13,
      marginTop: 8,
      marginBottom: 12,
    },
    agentBudgetChip: {
      flex: 1,
      height: 40,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
    },
    agentBudgetChipText: {
      fontSize: 14,
      fontWeight: '600',
      textAlign: 'center',
    },
    agentActionCard: {
      borderWidth: 1,
      borderRadius: radius.lg,
      padding: 16,
      marginBottom: 14,
    },
    agentActionTitle: {
      fontSize: typeScale.bodyLg,
      fontWeight: '700',
    },
    agentActionSubtitle: {
      fontSize: typeScale.footnote,
      marginTop: 2,
    },
    agentFastLaneTestBtn: {
      ...CHIP_SHAPE,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
    },
    agentFastLaneTestBtnText: {
      fontSize: typeScale.footnote,
      fontWeight: '700',
    },
    spendingLimitsLabel: {
      fontSize: 13,
      fontWeight: '500',
      marginBottom: 8,
      marginTop: 2,
    },
    spendingLimitsRow: {
      flexDirection: 'row',
      gap: 10,
      marginBottom: 14,
    },
    spendingLimitCard: {
      flex: 1,
      padding: 16,
      borderRadius: radius.lg,
      borderWidth: 1,
    },
    spendingLimitTitle: {
      fontSize: 13,
      fontWeight: '500',
      marginBottom: 4,
    },
    spendingLimitAmount: {
      fontSize: 18,
      fontWeight: '700',
      letterSpacing: -0.3,
    },
    agentEmptyText: {
      fontSize: 14,
      lineHeight: 20,
    },
    agentPrimaryPillBtn: {
      width: '100%',
      height: 48,
      borderRadius: radius.pill,
      justifyContent: 'center',
      alignItems: 'center',
    },
    agentPrimaryPillBtnText: {
      fontSize: 15,
      fontWeight: '700',
      letterSpacing: -0.2,
    },
    agentRunTradeBtn: {
      width: '100%',
      height: 48,
      borderRadius: radius.md,
      borderWidth: 1,
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: 4,
    },
    agentRunTradeBtnText: {
      fontSize: 15,
      fontWeight: '600',
      letterSpacing: -0.2,
    },
    emergencyTag: {
      fontSize: typeScale.caption,
      fontWeight: '600',
    },

    /* RECENT ACTIVITY */
    emptyActivityCard: {
      borderWidth: 1,
      borderRadius: radius.lg,
      paddingHorizontal: CARD_PADDING_X,
      paddingVertical: 24,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyActivityTitle: {
      fontSize: typeScale.bodyLg,
      fontWeight: '600',
      marginTop: 8,
      textAlign: 'center',
    },
    emptyActivitySubtitle: {
      fontSize: typeScale.footnote,
      marginTop: 2,
      textAlign: 'center',
    },
    activityList: {
      paddingHorizontal: 12,
      paddingBottom: 24,
    },
    activityGroupsWrapper: {
      gap: 6,
    },
    activityGroupSection: {
      marginBottom: 16,
    },
    activityGroupHeader: {
      fontSize: 13,
      fontWeight: '600',
      letterSpacing: -0.1,
      marginBottom: 8,
      marginLeft: 2,
    },
    activityGroupCard: {
      borderRadius: radius.lg,
      borderWidth: 1,
      paddingHorizontal: 16,
    },
    activityRowDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.borderDefault,
    },
    activityGroupLabel: {
      fontSize: typeScale.footnote,
      fontWeight: '600',
      letterSpacing: 0.2,
      paddingTop: 12,
      paddingBottom: 4,
    },
    activityRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 14,
    },
    activityLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      flex: 1,
      marginRight: 10,
    },
    activityIconCircle: {
      width: 42,
      height: 42,
      borderRadius: 21,
      borderWidth: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    activityItemTitle: {
      fontSize: 15,
      fontWeight: '700',
      letterSpacing: -0.2,
    },
    activitySubtitle: {
      fontSize: 12,
      marginTop: 2,
    },
    activityItemDate: {
      color: theme.textMuted,
      fontSize: 13,
      fontWeight: '500',
      marginTop: 2,
    },
    activityRight: {
      alignItems: 'flex-end',
      justifyContent: 'center',
    },
    activityAmount: {
      fontSize: 15,
      fontWeight: '600',
      letterSpacing: -0.2,
    },
    activityTimeText: {
      fontSize: 13.5,
      fontWeight: '500',
    },
    activityStatusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      marginTop: 2,
      justifyContent: 'flex-end',
    },
    activityStatusText: {
      fontSize: 11.5,
      fontWeight: '500',
    },
    activityConfirmedLabel: {
      color: theme.textMuted,
      fontSize: typeScale.caption,
    },
    /* MODAL COMMON STYLES */
    modalBackdrop: {
      flex: 1,
      backgroundColor: theme.scrim,
      justifyContent: 'flex-end',
    },
    modalSheet: {
      backgroundColor: theme.bgCard,
      borderColor: theme.borderDefault,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      borderWidth: 1,
      paddingHorizontal: 20,
      paddingTop: 12,
    },
    modalDragHandle: {
      width: 36,
      height: 4,
      borderRadius: radius.pill,
      alignSelf: 'center',
      marginBottom: 16,
    },
    modalSheetHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 18,
    },
    modalSheetTitle: {
      fontSize: typeScale.heading,
      fontWeight: '700',
    },

    /* EXPANDED SEND TRANSACTION & PREVIEW STYLES */
    /* One message slot under the recipient and amount fields, shared by the
       extraction notice, the rejection reason and the self-send warning. */
    /* A saved (named) shortcut reads as a name with its address underneath rather than
       as a hex blob, so the row is scannable and the address is still visible. */
    /* Inline "name this contact" row. It lives in the sheet instead of a dialog because
       the theme's dialog has no text input, and an address book without names is just
       another list of hex. */
    recipientAvatarSmall: {
      width: 20,
      height: 20,
      borderRadius: radius.pill,
      justifyContent: 'center',
      alignItems: 'center',
    },
    networkDotSmall: {
      width: 6,
      height: 6,
      borderRadius: radius.pill,
      backgroundColor: theme.emerald,
    },

    /* SECURITY SECTION REFRESH */
    securitySectionCard: {
      borderWidth: 1,
      borderRadius: radius.lg,
      padding: 16,
      marginBottom: 14,
    },
    securitySectionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 14,
    },
    securitySectionHeading: {
      fontSize: typeScale.bodyLg,
      fontWeight: '700',
      letterSpacing: -0.2,
    },
    credentialCompactRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 4,
    },
    credentialIconWrap: {
      width: 36,
      height: 36,
      borderRadius: radius.md,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    credentialName: {
      fontSize: typeScale.bodyLg,
      fontWeight: '600',
    },
    credentialSub: {
      fontSize: typeScale.footnote,
      marginTop: 2,
    },
    securityRowDivider: {
      height: 1,
      marginVertical: 10,
    },
    policyStatsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
    },
    policyStatTile: {
      width: '48%',
      flexGrow: 1,
      borderWidth: 1,
      borderRadius: radius.md,
      padding: 12,
    },
    policyStatLabel: {
      fontSize: typeScale.caption,
      fontWeight: '500',
      marginBottom: 4,
    },
    policyStatValue: {
      fontSize: typeScale.bodyLg,
      fontWeight: '700',
    },
    recoveryDetailRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 4,
    },
    recoveryDetailTitle: {
      fontSize: typeScale.bodyLg,
      fontWeight: '600',
    },
    recoveryDetailDesc: {
      fontSize: typeScale.footnote,
      marginTop: 2,
    },
    recoveryGuardianRow: {
      marginTop: 14,
      borderWidth: 1,
      borderRadius: radius.md,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    recoveryGuardianLabel: {
      fontSize: typeScale.micro,
      fontWeight: '700',
      letterSpacing: 0.6,
      marginBottom: 3,
    },
    recoveryGuardianValue: {
      fontSize: typeScale.body,
      fontWeight: '600',
    },
    recoveryGuardianNote: {
      fontSize: typeScale.caption,
      lineHeight: 15,
      marginTop: 4,
    },
    guardianToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      paddingVertical: 10,
    },
    guardianToggleText: {
      color: theme.textSecondary,
      fontSize: typeScale.caption,
      fontWeight: '600',
    },
    guardianEditor: {
      borderWidth: 1,
      borderRadius: radius.md,
      paddingHorizontal: 12,
      paddingVertical: 12,
      marginBottom: 4,
    },
    guardianInputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    guardianInput: { flex: 1, color: theme.textPrimary, fontSize: typeScale.caption, padding: 0 },
    guardianHint: {
      fontSize: typeScale.caption,
      lineHeight: 15,
      marginTop: 8,
      marginBottom: 12,
    },
    recoveryActionRow: {
      // Stacked, not side by side. Both buttons are `width: '100%'` with their label
      // clipped by `overflow: 'hidden'`, so sharing a row made the pair wider than the
      // box it sits in and "Execute Recovery" hung over the amber border. Full-width
      // rows also survive a large system font, which a 50/50 split would not.
      gap: 10,
      marginTop: 14,
    },
    recoveryPendingBox: {
      marginTop: 14,
      borderWidth: 1,
      borderRadius: radius.md,
      paddingHorizontal: 12,
      paddingVertical: 12,
      backgroundColor: theme.amberBg,
      borderColor: theme.amberBorder,
    },
    recoveryPendingHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    recoveryPendingTitle: {
      fontSize: typeScale.body,
      fontWeight: '700',
    },

    /* LEGACY SECURITY COMPAT */
    securityRowCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      borderWidth: 1,
      borderRadius: radius.lg,
      padding: 14,
      marginBottom: 14,
    },
    securityCardIconWrap: {
      width: 36,
      height: 36,
      borderRadius: radius.pill,
      backgroundColor: theme.accentLight,
      justifyContent: 'center',
      alignItems: 'center',
    },
    securityItemTitle: {
      fontSize: typeScale.bodyLg,
      fontWeight: '600',
    },
    securityItemDesc: {
      color: theme.textMuted,
      fontSize: typeScale.footnote,
      lineHeight: 16,
      marginTop: 2,
    },
    securityGroupCard: {
      borderWidth: 1,
      borderRadius: radius.lg,
      padding: 16,
      marginBottom: 14,
    },
    securityGroupLabel: {
      color: theme.textMuted,
      fontSize: typeScale.caption,
      fontWeight: '700',
      letterSpacing: 0.8,
      marginBottom: 12,
    },
    securitySpecRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 6,
    },
    specLabelWithIcon: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    securitySpecTitle: {
      fontSize: typeScale.bodyLg,
      fontWeight: '500',
    },
    securitySpecSub: {
      color: theme.textMuted,
      fontSize: typeScale.caption,
      marginTop: 1,
    },
    activeTag: {
      ...TAG_SHAPE,
      backgroundColor: theme.emeraldBg,
      borderWidth: 1,
      borderColor: theme.emeraldBorder,
    },
    activeTagText: {
      color: theme.emeraldText,
      fontSize: typeScale.caption,
      fontWeight: '600',
    },
    quorumTag: {
      ...TAG_SHAPE,
      backgroundColor: theme.bgElevated,
      borderWidth: 1,
      borderColor: theme.borderSubtle,
    },
    quorumTagText: {
      color: theme.textSecondary,
      fontSize: typeScale.caption,
      fontWeight: '600',
    },
    specInnerDivider: {
      height: 1,
      backgroundColor: theme.borderSubtle,
      marginVertical: 8,
    },
    specKeyValueRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 6,
    },
    specKeyText: {
      color: theme.textMuted,
      fontSize: typeScale.body,
    },
    specValueText: {
      fontSize: typeScale.body,
      fontWeight: '600',
    },
    freezeSectionCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      borderWidth: 1,
      borderRadius: radius.lg,
      padding: 14,
      marginBottom: 14,
    },
    freezeTitle: {
      fontSize: typeScale.bodyLg,
      fontWeight: '600',
    },
    freezeDesc: {
      color: theme.textMuted,
      fontSize: typeScale.footnote,
      lineHeight: 16,
      marginTop: 2,
    },
    panicBtn: {
      ...CHIP_SHAPE,
      backgroundColor: theme.bgElevated,
    },
    panicBtnActive: {
      backgroundColor: theme.roseSurface,
      borderWidth: 1,
      borderColor: theme.rose,
    },
    panicBtnText: {
      color: theme.roseText,
      fontSize: typeScale.footnote,
      fontWeight: '600',
    },
    auditLogRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      paddingVertical: 6,
    },
    auditLogText: {
      color: theme.textSecondary,
      fontSize: typeScale.footnote,
      fontWeight: '500',
    },
    auditLogTime: {
      color: theme.textMuted,
      fontSize: typeScale.caption,
      marginTop: 2,
    },

    /* INPUTS & FORM MODALS */
    maxLinkText: {
      color: theme.accent,
      fontSize: typeScale.footnote,
      fontWeight: '500',
    },
    modalInputStandalone: {
      borderWidth: 1,
      borderRadius: radius.md,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: typeScale.title,
    },
    riskCardNotice: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: theme.accentLight,
      borderWidth: 1,
      borderColor: theme.borderDefault,
      borderRadius: radius.md,
      padding: 12,
      marginTop: 14,
      marginBottom: 20,
    },
    riskCardNoticeQuorum: {
      backgroundColor: theme.amberBg,
      borderColor: theme.amberBorder,
    },
    riskNoticeText: {
      flex: 1,
      color: theme.textSecondary,
      fontSize: typeScale.footnote,
      lineHeight: 16,
    },
    modalPrimaryActionBtn: {
      backgroundColor: theme.accent,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 15,
      borderRadius: radius.lg,
    },
    modalPrimaryActionBtnText: {
      color: theme.accentForeground,
      fontSize: typeScale.title,
      fontWeight: '600',
    },

    /* RECEIVE MODAL */
    receiveExplainerText: {
      color: theme.textSecondary,
      fontSize: 14,
      lineHeight: 20,
      marginBottom: 16,
    },
    receiveMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 18,
    },
    receiveNetworkPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: radius.pill,
      backgroundColor: theme.isDark ? 'rgba(255, 255, 255, 0.05)' : '#F8FAFC',
      borderWidth: 1,
      borderColor: theme.isDark ? 'rgba(255, 255, 255, 0.1)' : '#E2E8F0',
    },
    receiveNetworkDot: {
      width: 7,
      height: 7,
      borderRadius: 3.5,
      backgroundColor: '#F59E0B',
    },
    receiveNetworkPillText: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.textPrimary,
    },
    receiveMetaText: {
      fontSize: 13,
      fontWeight: '500',
      color: theme.textMuted,
      textAlign: 'right',
    },
    qrContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'center',
      marginBottom: 16,
    },
    addressDisplayBox: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderWidth: 1,
      borderColor: theme.isDark ? 'rgba(255, 255, 255, 0.08)' : '#E2E8F0',
      backgroundColor: theme.isDark ? 'rgba(255, 255, 255, 0.04)' : '#F8FAFC',
      borderRadius: 14,
      paddingHorizontal: 16,
      paddingVertical: 14,
      marginBottom: 14,
      gap: 10,
    },
    addressDisplayText: {
      flex: 1,
      fontSize: 13,
      fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
      color: theme.textPrimary,
      fontWeight: '500',
      letterSpacing: 0.2,
    },
    receiveWarning: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      backgroundColor: theme.amberBg,
      borderWidth: 1,
      borderColor: theme.amberBorder,
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginBottom: 18,
    },
    receiveWarningText: {
      flex: 1,
      fontSize: 12.5,
      lineHeight: 18,
      fontWeight: '500',
      color: theme.amberText,
    },
    receiveShareBtn: {
      width: '100%',
      height: 52,
      backgroundColor: '#4F46E5',
      borderRadius: 14,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    receiveShareBtnText: {
      color: '#FFFFFF',
      fontSize: 15,
      fontWeight: '600',
    },

    modalSecondaryBtn: {
      flex: 1,
      borderWidth: 1,
      paddingVertical: 14,
      borderRadius: radius.md,
      alignItems: 'center',
    },
    modalSecondaryBtnText: {
      fontSize: typeScale.bodyLg,
      fontWeight: '600',
    },
    modalDangerBtn: {
      flex: 1,
      backgroundColor: theme.roseBg,
      borderWidth: 1,
      borderColor: theme.roseBorder,
      paddingVertical: 14,
      borderRadius: radius.md,
      alignItems: 'center',
    },
    modalDangerBtnText: {
      color: theme.roseText,
      fontSize: typeScale.bodyLg,
      fontWeight: '600',
    },

    /* OVERFLOW MENU */
    menuBackdrop: {
      flex: 1,
      backgroundColor: theme.scrim,
      justifyContent: 'flex-end',
      paddingHorizontal: 16,
    },
    overflowSheet: {
      borderWidth: 1,
      borderRadius: radius.lg,
      padding: 8,
    },
    overflowRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 12,
      paddingHorizontal: 14,
    },
    overflowRowText: {
      fontSize: typeScale.title,
      fontWeight: '500',
    },
    overflowDivider: {
      height: 1,
      backgroundColor: theme.borderSubtle,
    },

    /* 9. SAFE LOCK OVERLAY */
    safeLockContainer: {
      flex: 1,

      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 24,
    },
    safeLockCard: {
      width: '100%',
      maxWidth: 380,
      borderRadius: radius.xl,
      borderWidth: 1,
      padding: 28,
      alignItems: 'center',
    },
    safeLockIconWrap: {
      width: 64,
      height: 64,
      borderRadius: radius.xl,
      borderWidth: 1,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 20,
    },
    safeLockTitle: {
      fontSize: typeScale.display,
      fontWeight: '700',
      letterSpacing: -0.4,
      marginBottom: 8,
    },
    safeLockSubtitle: {
      color: theme.textSecondary,
      fontSize: typeScale.bodyLg,
      textAlign: 'center',
      marginBottom: 6,
    },
    safeLockWalletName: {
      color: theme.textMuted,
      fontSize: typeScale.body,
      fontWeight: '600',
      marginBottom: 26,
    },
    unlockButton: {
      width: '100%',
      height: 52,
      borderRadius: radius.lg,
      backgroundColor: theme.accent,
      justifyContent: 'center',
      alignItems: 'center',
    },
    unlockButtonText: {
      color: theme.accentForeground,
      fontSize: typeScale.title,
      fontWeight: '700',
      letterSpacing: -0.2,
    },
    // On-Chain Deployment Banner
    onChainStatusBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      paddingHorizontal: 12,
      paddingVertical: 9,
      borderRadius: radius.md,
      borderWidth: 1,
      marginTop: 14,
    },
    onChainStatusDot: {
      width: 8,
      height: 8,
      borderRadius: radius.pill,
    },
    onChainStatusText: {
      fontSize: typeScale.footnote,
      fontWeight: '600',
      flexShrink: 1,
    },
    deployPdaButton: {
      ...CHIP_SHAPE,
    },
    deployPdaButtonText: {
      fontSize: typeScale.caption,
      fontWeight: '700',
    },
    // Activity Filters
    activityFilterRow: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 16,
    },
    activityFilterScroll: {
      marginBottom: 16,
      marginHorizontal: -20,
    },
    activityFilterContent: {
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 20,
    },
    activityFilterChip: {
      borderRadius: 20,
      paddingVertical: 7.5,
      paddingHorizontal: 15,
      borderWidth: 1,
    },
    activityFilterChipActive: {
      backgroundColor: theme.isDark ? 'rgba(108, 140, 255, 0.14)' : 'rgba(108, 140, 255, 0.08)',
      borderColor: theme.accent,
    },
    activityFilterChipInactive: {
      backgroundColor: theme.isDark ? '#15171B' : '#F4F5F7',
      borderColor: theme.borderDefault,
    },
    activityFilterChipText: {
      fontSize: 13,
    },
    activityFilterChipTextActive: {
      color: theme.accent,
      fontWeight: '600',
    },
    activityFilterChipTextInactive: {
      color: theme.textSecondary,
      fontWeight: '500',
    },
    activitySecurityBadge: {
      fontSize: typeScale.caption,
      fontWeight: '500',
    },
    confirmedBadgeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      marginTop: 2,
    },
    confirmedBadgeText: {
      color: theme.emeraldText,
      fontSize: typeScale.caption,
      fontWeight: '500',
    },
    // Sub-Agent Details
    subAgentItem: {
      paddingVertical: 4,
    },
    subAgentHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 4,
    },
    subAgentTitleWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    subAgentName: {
      fontSize: typeScale.bodyLg,
      fontWeight: '600',
    },
    subAgentDesc: {
      fontSize: typeScale.footnote,
      lineHeight: 16,
      marginBottom: 6,
    },
    subAgentMetaRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    subAgentMetaText: {
      fontSize: typeScale.footnote,
      fontWeight: '500',
    },
    sessionGrantExplainer: {
      fontSize: typeScale.footnote,
      lineHeight: 16,
      marginBottom: 12,
    },
    sessionInputRow: {
      flexDirection: 'row',
      gap: 12,
      marginBottom: 10,
    },
    sessionInputLabel: {
      fontSize: typeScale.footnote,
      fontWeight: '500',
      marginBottom: 4,
    },
    sessionInputBox: {
      height: 42,
      borderRadius: radius.md,
      borderWidth: 1,
      paddingHorizontal: 12,
      fontSize: typeScale.bodyLg,
      fontWeight: '600',
    },
    zeroPromptBadgeText: {
      fontSize: typeScale.footnote,
      textAlign: 'center',
      marginTop: 4,
    },
    // Transaction Details Modal
    txDetailHeroCard: {
      alignItems: 'center',
      paddingVertical: 18,
      marginBottom: 14,
    },
    txDetailIconCircle: {
      width: 60,
      height: 60,
      borderRadius: radius.pill,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 12,
    },
    txDetailAmountText: {
      fontSize: typeScale.displayLg,
      fontWeight: '800',
      letterSpacing: -0.5,
      marginBottom: 4,
    },
    txDetailNoValueText: {
      fontSize: typeScale.title,
      fontWeight: '600',
      marginBottom: 12,
    },
    txDetailFiatText: {
      fontSize: typeScale.body,
      marginBottom: 10,
    },
    txDetailConfirmedPill: {
      ...TAG_SHAPE,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
      backgroundColor: theme.emeraldBg,
    },
    txDetailConfirmedText: {
      color: theme.emeraldText,
      fontSize: typeScale.footnote,
      fontWeight: '600',
    },
    addressCopyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: radius.md,
      borderWidth: 1,
    },
    addressCopyRowText: {
      fontSize: typeScale.footnote,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      flex: 1,
      marginRight: 8,
    },
    explorerButton: {
      height: 48,
      borderRadius: radius.md,
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 8,
    },
    explorerButtonText: {
      color: theme.accentForeground,
      fontSize: typeScale.bodyLg,
      fontWeight: '700',
    },
    explorerButtonSecondary: {
      height: 46,
      borderRadius: radius.md,
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 8,
      borderWidth: 1,
      backgroundColor: theme.bgElevated,
      borderColor: theme.borderDefault,
    },
    explorerButtonSecondaryText: {
      color: theme.textPrimary,
      fontSize: typeScale.body,
      fontWeight: '600',
    },
    agentMiniProgressBar: {
      height: 4,
      borderRadius: radius.pill,
      overflow: 'hidden',
      marginTop: 6,
      width: '100%',
    },
    agentMiniProgressFill: {
      height: '100%',
      borderRadius: radius.pill,
    },

    /* Shared surface / text treatments.
     These used to live in a second style object built inline in JSX because a
     module-level StyleSheet could not see the palette. Now that the sheet is
     built from the theme, one mechanism covers both. */
    card: { 
      backgroundColor: theme.bgCard, 
      borderWidth: 1, 
      borderColor: theme.borderDefault,
      borderRadius: radius.xl,
    },
    elevatedCard: { backgroundColor: theme.bgElevated, borderColor: theme.borderDefault },
    textPrimary: { color: theme.textPrimary },
    textSecondary: { color: theme.textSecondary },
    textMuted: { color: theme.textMuted },
    input: { backgroundColor: theme.bgInput, borderColor: theme.borderDefault, color: theme.textPrimary },
    divider: { backgroundColor: theme.borderSubtle },
    iconBtn: { backgroundColor: theme.bgElevated, borderColor: theme.borderDefault },
    actionBtn: { backgroundColor: theme.bgElevated, borderColor: theme.borderDefault },
    actionBtnText: { color: theme.textPrimary },
  })

export function useWalletStyles() {
  const { theme } = useAppTheme()
  return useMemo(() => createStyles(theme), [theme])
}
