// Reimplements backend/app/crypto_identity.py exactly - same algorithms,
// same field layout, same byte-for-byte wire format, so this phone and a
// desktop instance can derive identical shared secrets and decrypt each
// other's frames. See that file's own docstring for the full design
// rationale (trust-on-first-use, directional keys, signed discovery).
//
// Two separate long-lived keypairs, same as the Python side:
//   - X25519 for the shared encryption secret
//   - Ed25519 for signing discovery announcements
// Never reused for each other's purpose - see crypto_identity.py.

import 'dart:convert';
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';

final _x25519 = X25519();
final _ed25519 = Ed25519();
final _chacha = Chacha20.poly1305Aead();

const hkdfInfo = 'agora-transport-v1';
const nonceLen = 12;

class DecryptionError implements Exception {
  final String message;
  DecryptionError(this.message);
  @override
  String toString() => 'DecryptionError: $message';
}

/// Returns (privateKeyB64, publicKeyB64) for a brand-new X25519 identity.
Future<(String, String)> generateKeypair() async {
  final keyPair = await _x25519.newKeyPair();
  final privateBytes = await keyPair.extractPrivateKeyBytes();
  final publicKey = await keyPair.extractPublicKey();
  return (base64.encode(privateBytes), base64.encode(publicKey.bytes));
}

Future<SecretKey> _rawSharedSecret(String myPrivateKeyB64, String theirPublicKeyB64) async {
  final keyPair = await _x25519.newKeyPairFromSeed(base64.decode(myPrivateKeyB64));
  final theirPublicKey = SimplePublicKey(base64.decode(theirPublicKeyB64), type: KeyPairType.x25519);
  return _x25519.sharedSecretKey(keyPair: keyPair, remotePublicKey: theirPublicKey);
}

/// Returns (sendKey, recvKey) for talking to one specific peer - see
/// crypto_identity.py's derive_directional_keys for why this has to be
/// directional (a single shared key is a confirmed, exploitable reflection
/// attack), not just a byte-for-byte reimplementation detail.
Future<(List<int>, List<int>)> deriveDirectionalKeys(
  String myPrivateKeyB64,
  String theirPublicKeyB64,
  String myPeerId,
  String theirPeerId,
) async {
  final sharedSecret = await _rawSharedSecret(myPrivateKeyB64, theirPublicKeyB64);
  final hkdf = Hkdf(hmac: Hmac.sha256(), outputLength: 32);
  final sendInfo = utf8.encode('$hkdfInfo|$myPeerId->$theirPeerId');
  final recvInfo = utf8.encode('$hkdfInfo|$theirPeerId->$myPeerId');
  final sendKey = await hkdf.deriveKey(secretKey: sharedSecret, info: sendInfo);
  final recvKey = await hkdf.deriveKey(secretKey: sharedSecret, info: recvInfo);
  return (await sendKey.extractBytes(), await recvKey.extractBytes());
}

/// Random 96-bit nonce per call, same as the Python side - at this app's
/// real message/chunk volumes a random-nonce collision isn't a realistic
/// concern, so there's no counter/state to persist or coordinate.
/// Returns nonce || ciphertext (ciphertext already includes the 16-byte tag).
Future<Uint8List> encrypt(List<int> key, List<int> plaintext) async {
  final secretKey = SecretKey(key);
  final nonce = _chacha.newNonce();
  final box = await _chacha.encrypt(plaintext, secretKey: secretKey, nonce: nonce);
  return Uint8List.fromList([...nonce, ...box.cipherText, ...box.mac.bytes]);
}

Future<Uint8List> decrypt(List<int> key, List<int> blob) async {
  if (blob.length < nonceLen) {
    throw DecryptionError('frame too short to contain a nonce');
  }
  final nonce = blob.sublist(0, nonceLen);
  final rest = blob.sublist(nonceLen);
  if (rest.length < 16) {
    throw DecryptionError('frame too short to contain an auth tag');
  }
  final cipherText = rest.sublist(0, rest.length - 16);
  final mac = Mac(rest.sublist(rest.length - 16));
  final secretKey = SecretKey(key);
  final box = SecretBox(cipherText, nonce: nonce, mac: mac);
  try {
    final plaintext = await _chacha.decrypt(box, secretKey: secretKey);
    return Uint8List.fromList(plaintext);
  } catch (e) {
    throw DecryptionError(e.toString());
  }
}

// -- discovery-broadcast signing (Ed25519) -----------------------------------

/// Returns (signingPrivateKeyB64, signingPublicKeyB64).
Future<(String, String)> generateSigningKeypair() async {
  final keyPair = await _ed25519.newKeyPair();
  final privateBytes = await keyPair.extractPrivateKeyBytes();
  final publicKey = await keyPair.extractPublicKey();
  return (base64.encode(privateBytes), base64.encode(publicKey.bytes));
}

/// The exact bytes a discovery announcement's signature covers - plain
/// \x1f-delimited fields, not JSON (see crypto_identity.py's own comment
/// on why: dict key order/whitespace must never matter here). device_name
/// is deliberately NOT included - cosmetic, not security-relevant.
Uint8List announcementBytes(String peerId, String address, int port, String publicKey) {
  final fields = [peerId, address, port.toString(), publicKey];
  return Uint8List.fromList(utf8.encode(fields.join('\x1f')));
}

Future<String> signAnnouncement(String signingPrivateKeyB64, String peerId, String address, int port, String publicKey) async {
  final keyPair = await _ed25519.newKeyPairFromSeed(base64.decode(signingPrivateKeyB64));
  final signature = await _ed25519.sign(announcementBytes(peerId, address, port, publicKey), keyPair: keyPair);
  return base64.encode(signature.bytes);
}

/// False for anything invalid (never throws) - matches the Python side's
/// own "one uniform outcome" contract so a caller never needs to
/// distinguish a malformed key from a genuinely wrong signature.
Future<bool> verifyAnnouncement(String signingPublicKeyB64, String signatureB64, String peerId, String address, int port, String publicKey) async {
  try {
    final publicKeyObj = SimplePublicKey(base64.decode(signingPublicKeyB64), type: KeyPairType.ed25519);
    final signature = Signature(base64.decode(signatureB64), publicKey: publicKeyObj);
    return await _ed25519.verify(announcementBytes(peerId, address, port, publicKey), signature: signature);
  } catch (_) {
    return false;
  }
}
