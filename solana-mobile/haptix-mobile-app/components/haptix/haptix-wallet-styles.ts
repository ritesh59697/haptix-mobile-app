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
      borderBottomColor: theme.borderSubtle,
      borderBottomWidth: 1,
      // Matches scrollContent so the brand chip lines up with the card edges below.
      paddingHorizontal: 20,
      paddingBottom: 12,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    headerLeftGroup: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      flexShrink: 1,
    },
    avatarButton: {
      justifyContent: 'center',
      alignItems: 'center',
    },
    avatarCircle: {
      width: 36,
      height: 36,
      borderRadius: radius.pill,
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
    headerWalletName: {
      fontSize: typeScale.title,
      fontWeight: '700',
      letterSpacing: -0.2,
      // Was 140, measured against the old 15dp title. The name truncates on one
      // line, so the cap has to grow with the type it caps: 140 * (17/15).
      maxWidth: 160,
    },
    addressCopyChip: {
      ...TAG_SHAPE,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
      borderWidth: 1,
      marginTop: space.xxs,
      alignSelf: 'flex-start',
    },
    addressCopyText: {
      fontSize: typeScale.caption,
      fontWeight: '500',
    },
    headerRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
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
      paddingHorizontal: 20,
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
      borderRadius: radius.xl,
      borderWidth: 1,
      padding: CARD_PADDING_X,
      marginBottom: 14,
    },
    heroBalanceLabelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 10,
    },
    heroBalanceLabel: {
      fontSize: typeScale.body,
      fontWeight: '500',
    },
    eyeToggleButton: {
      padding: 4,
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
      fontSize: typeScale.hero,
      fontWeight: '700',
      letterSpacing: -0.6,
    },
    heroSecondaryBalance: {
      fontSize: typeScale.bodyLg,
      fontWeight: '500',
      marginTop: 3,
    },
    heroActionsRow: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 2,
    },
    heroActionBtn: {
      flex: 1,
      height: 44,
      borderRadius: radius.md,
      borderWidth: 1,
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 6,
    },
    heroActionBtnText: {
      fontSize: typeScale.body,
      fontWeight: '600',
      letterSpacing: -0.1,
      flexShrink: 1,
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
      // The title stays on the card edge (like the segmented control above it) while the
      // "See all" action is pulled in to the card's inner content column, so it lines up
      // with the right-aligned amounts in the list below instead of the card's border.
      paddingRight: CARD_PADDING_X,
      marginTop: 22,
      marginBottom: 10,
    },

    homeSectionTitle: {
      fontSize: typeScale.title,
      fontWeight: '700',
      letterSpacing: -0.2,
    },

    homeSectionLink: {
      fontSize: typeScale.body,
      fontWeight: '600',
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

    /* ASSETS LIST (CLEAN LIST WITHOUT CARD CLUTTER) */
    assetList: {
      borderRadius: radius.lg,
      borderWidth: 1,
      paddingHorizontal: CARD_PADDING_X,
    },
    assetRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 14,
    },
    assetLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    assetLogoWrap: {
      width: 38,
      height: 38,
      borderRadius: radius.pill,
      borderWidth: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    assetPrimaryName: {
      fontSize: typeScale.title,
      fontWeight: '600',
    },
    assetSecondaryTag: {
      fontSize: typeScale.footnote,
      marginTop: 2,
    },
    assetRight: {
      alignItems: 'flex-end',
    },
    assetCryptoAmount: {
      fontSize: typeScale.title,
      fontWeight: '600',
    },
    assetFiatAmount: {
      fontSize: typeScale.footnote,
      marginTop: 2,
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
    },
    agentRecipientInput: {
      borderWidth: 1,
      borderRadius: radius.md,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginTop: 12,
      fontSize: typeScale.footnote,
    },
    agentRecipientHint: {
      fontSize: typeScale.caption,
      marginTop: 6,
    },
    agentBudgetChip: {
      ...CHIP_SHAPE,
      flex: 1,
      alignItems: 'center',
      borderWidth: 1,
    },
    agentBudgetChipText: {
      fontSize: typeScale.body,
      fontWeight: '600',
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
      borderWidth: 1,
      borderRadius: radius.lg,
      paddingHorizontal: CARD_PADDING_X,
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
      paddingVertical: 12,
    },
    activityLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    activityIconCircle: {
      width: 34,
      height: 34,
      borderRadius: radius.pill,
      borderWidth: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    activityItemTitle: {
      fontSize: typeScale.bodyLg,
      fontWeight: '500',
    },
    activityItemDate: {
      color: theme.textMuted,
      fontSize: typeScale.footnote,
      marginTop: 2,
    },
    activityRight: {
      alignItems: 'flex-end',
    },
    activityAmount: {
      fontSize: typeScale.bodyLg,
      fontWeight: '600',
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
      fontSize: typeScale.body,
      lineHeight: 18,
      marginBottom: 16,
    },
    receiveMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: space.sm,
      marginBottom: 14,
    },
    receiveNetworkPill: {
      ...TAG_SHAPE,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderWidth: 1,
    },
    receiveNetworkPillText: {
      fontSize: typeScale.caption,
      fontWeight: '600',
    },
    receiveMetaText: {
      flex: 1,
      fontSize: typeScale.caption,
      textAlign: 'right',
    },
    receiveWarning: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      backgroundColor: theme.amberBg,
      borderWidth: 1,
      borderColor: theme.amberBorder,
      borderRadius: radius.md,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 14,
    },
    receiveWarningText: {
      flex: 1,
      fontSize: typeScale.caption,
      lineHeight: 16,
    },
    qrContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'center',
      marginBottom: 14,
    },
    addressDisplayBox: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderWidth: 1,
      borderRadius: radius.md,
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginBottom: 14,
      gap: 8,
    },
    addressDisplayText: {
      flex: 1,
      fontSize: typeScale.footnote,
      fontFamily: 'SpaceMono',
      letterSpacing: -0.3,
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
      gap: space.sm,
      marginBottom: space.md,
    },
    activityFilterChip: {
      ...CHIP_SHAPE,
      borderWidth: 1,
    },
    activityFilterChipText: {
      fontSize: typeScale.body,
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
    card: { backgroundColor: theme.bgCard, borderColor: theme.borderDefault },
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
