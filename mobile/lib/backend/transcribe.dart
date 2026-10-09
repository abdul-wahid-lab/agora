// On-device voice-message transcription - mobile port of
// backend/app/transcribe.py. The Python side runs pywhispercpp directly;
// no such package exists for Dart, so this is a real (not stubbed) port
// onto whisper_ggml, a maintained Flutter wrapper around the same
// whisper.cpp engine. Fully offline once the model is cached: the one
// exception, same as the Python side's own docstring and consistent with
// how this app's update-checker already touches the internet, is the
// model file itself being downloaded once, the first time transcription
// is ever used, and cached locally after that.
//
// "base" (a multilingual model, ~142MB) is used rather than an
// English-only variant, for the identical reason transcribe.py chose it:
// real conversations aren't guaranteed to be in English - lang: 'auto'
// lets whisper.cpp detect it per clip rather than forcing one.

import 'dart:async';
import 'dart:io';

import 'package:whisper_ggml/whisper_ggml.dart';

const _model = WhisperModel.base;

class VoiceTranscriber {
  final _controller = WhisperController();
  bool _modelReady = false;
  Future<void>? _pending;

  Future<void> _ensureModel() async {
    if (_modelReady) return;
    final path = await _controller.getPath(_model);
    if (!await File(path).exists()) {
      await _controller.downloadModel(_model);
    }
    _modelReady = true;
  }

  /// Runs the actual decode+inference, serialized behind a lock (mirrors
  /// transcribe.py's own _model_lock) since the underlying whisper.cpp
  /// context isn't meant to run two transcriptions at once.
  Future<String> transcribeFile(String path) {
    final previous = _pending ?? Future.value();
    final completer = Completer<String>();
    _pending = previous.then((_) async {
      try {
        await _ensureModel();
        final result = await _controller.transcribe(model: _model, audioPath: path, lang: 'auto');
        completer.complete(result?.transcription.text.trim() ?? '');
      } catch (e, st) {
        completer.completeError(e, st);
      }
    });
    return completer.future;
  }
}
