import 'dart:math';

// Real file-name-derived display helpers shared by the chat timeline, send
// confirm sheet, and received-file actions sheet - no made-up file-type
// taxonomy, just the extension itself, uppercased and truncated to fit the
// same small badge the design uses for every type ("PDF", "ZIP", "MOV"...).
String fileTypeBadge(String filename) {
  final dot = filename.lastIndexOf('.');
  if (dot == -1 || dot == filename.length - 1) return 'FILE';
  final ext = filename.substring(dot + 1).toUpperCase();
  return ext.length > 4 ? ext.substring(0, 4) : ext;
}

String humanFileSize(int bytes) {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  final i = (log(bytes) / log(1024)).floor().clamp(0, units.length - 1);
  final value = bytes / pow(1024, i);
  final text = i == 0 ? value.toStringAsFixed(0) : value.toStringAsFixed(value < 10 ? 1 : 0);
  return '$text ${units[i]}';
}

String humanSpeed(num bytesPerSec) => '${humanFileSize(bytesPerSec.round())}/s';

String humanEta(num? seconds) {
  if (seconds == null) return '';
  final s = seconds.round();
  if (s < 60) return '$s s left';
  final m = s ~/ 60;
  return '$m min left';
}
