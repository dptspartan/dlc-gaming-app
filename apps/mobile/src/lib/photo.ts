import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';
import { uploadLocalImage } from './supabase';

/** Pick a photo from the gallery (or the camera) and upload it to `folder`; null when nothing was picked. */
export async function pickAndUpload(folder: string, camera = false): Promise<string | null> {
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.7, allowsEditing: true };
  if (camera) {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera permission is needed to take a photo.');
      return null;
    }
  }
  const res = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  const asset = res.canceled ? undefined : res.assets[0];
  if (!asset) return null;
  return uploadLocalImage(asset.uri, asset.mimeType, folder);
}
