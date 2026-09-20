import { AppView } from '@/components/app-view'
import { AppText } from '@/components/app-text'
import { PublicKey } from '@solana/web3.js'
import { ActivityIndicator, TextInput, View, Platform, Alert } from 'react-native'
import React, { useState } from 'react'
import { Button } from '@react-navigation/elements'
import { useThemeColor } from '@/hooks/use-theme-color'
import { useMutation } from '@tanstack/react-query'
import { useMobileWallet } from '@wallet-ui/react-native-web3js'
import { ellipsify } from '@/utils/ellipsify'

function showSnackbar(text: string) {
  if (Platform.OS === 'web') {
    Alert.alert('Notice', text)
  } else {
    try {
      const Snackbar = require('react-native-snackbar').default
      Snackbar.show({ text, duration: Snackbar.LENGTH_SHORT })
    } catch {
      Alert.alert('Notice', text)
    }
  }
}

function useSignMessages() {
  const { signMessages } = useMobileWallet()
  return useMutation({
    mutationFn: async (input: { message: string }) => {
      return signMessages(new TextEncoder().encode(input.message)).then((signature) => signature.toString())
    },
  })
}

export function DemoFeatureSignMessage({ address }: { address: PublicKey }) {
  const signMessagesMutation = useSignMessages()
  const [message, setMessage] = useState('Hello world')
  const backgroundColor = useThemeColor({ light: '#f0f0f0', dark: '#333333' }, 'background')
  const textColor = useThemeColor({ light: '#000000', dark: '#ffffff' }, 'text')

  return (
    <AppView>
      <AppText type="subtitle">Sign message with connected wallet.</AppText>

      <View style={{ gap: 16 }}>
        <AppText>Message</AppText>
        <TextInput
          style={{
            backgroundColor,
            color: textColor,
            borderWidth: 1,
            borderRadius: 25,
            paddingHorizontal: 16,
          }}
          value={message}
          onChangeText={setMessage}
        />
        {signMessagesMutation.isPending ? (
          <ActivityIndicator />
        ) : (
          <Button
            disabled={signMessagesMutation.isPending || message?.trim() === ''}
            onPress={() => {
              signMessagesMutation
                .mutateAsync({ message })
                .then(() => {
                  console.log(`Signed message: ${message} with ${address.toString()}`)
                  showSnackbar(`Signed message with ${ellipsify(address.toString(), 8)}`)
                })
                .catch((err) => console.log(`Error signing message: ${err}`, err))
            }}
            variant="filled"
          >
            Sign Message
          </Button>
        )}
      </View>
      {signMessagesMutation.isError ? (
        <AppText style={{ color: 'red', fontSize: 12 }}>{`${signMessagesMutation.error.message}`}</AppText>
      ) : null}
    </AppView>
  )
}
