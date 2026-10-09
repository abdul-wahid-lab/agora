import 'dart:async';

import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

// Mirrors the desktop app's own localStorage keys (App.jsx's ONBOARDING_KEY,
// "agora.chosenName", avatar.js's SELF_AVATAR_INDEX_KEY) - same concepts,
// same persistence model (per-device, local-only, nothing synced), just
// backed by shared_preferences instead of a browser's localStorage.
class AppPrefs {
  static const _onboardedKey = 'agora.onboarded';
  static const _chosenNameKey = 'agora.chosenName';
  static const _avatarIndexKey = 'agora.avatarIndex';
  static const _selfPhotoPathKey = 'agora.selfPhotoPath';
  static const _peerIdKey = 'agora.peerId';
  static const _visibleInNearbyKey = 'agora.visibleInNearby';

  final SharedPreferences _prefs;
  AppPrefs._(this._prefs);

  static Future<AppPrefs> load() async => AppPrefs._(await SharedPreferences.getInstance());

  // Generated once and reused forever (matches the desktop Electron
  // shell's own identity.json pattern) - a fresh random peer_id on every
  // launch would make every restart look like a brand-new, historyless
  // contact to every peer that's ever talked to this device.
  String get peerId {
    final existing = _prefs.getString(_peerIdKey);
    if (existing != null) return existing;
    final fresh = const Uuid().v4();
    unawaited(_prefs.setString(_peerIdKey, fresh));
    return fresh;
  }

  bool get onboarded => _prefs.getBool(_onboardedKey) ?? false;
  Future<void> setOnboarded(bool value) => _prefs.setBool(_onboardedKey, value);

  String? get chosenName => _prefs.getString(_chosenNameKey);
  Future<void> setChosenName(String value) => _prefs.setString(_chosenNameKey, value);

  int get avatarIndex => _prefs.getInt(_avatarIndexKey) ?? 0;
  Future<void> setAvatarIndex(int value) => _prefs.setInt(_avatarIndexKey, value);

  bool get visibleInNearby => _prefs.getBool(_visibleInNearbyKey) ?? true;
  Future<void> setVisibleInNearby(bool value) => _prefs.setBool(_visibleInNearbyKey, value);

  String? get selfPhotoPath => _prefs.getString(_selfPhotoPathKey);
  Future<void> setSelfPhotoPath(String? value) async {
    if (value == null) {
      await _prefs.remove(_selfPhotoPathKey);
    } else {
      await _prefs.setString(_selfPhotoPathKey, value);
    }
  }
}
