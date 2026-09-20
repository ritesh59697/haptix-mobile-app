import { useEffect } from 'react'
import { useRouter } from 'expo-router'
import { View } from 'react-native'

export default function Send() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/(tabs)/account')
  }, [router])

  return <View style={{ flex: 1, backgroundColor: '#050811' }} />
}
