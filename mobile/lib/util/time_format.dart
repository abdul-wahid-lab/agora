// Shared "9:38" / "Yesterday" / "10/3" formatting for conversation and
// message timestamps - real device-clock-derived values, matching the
// design's own time labels exactly (no AM/PM shown anywhere in the design).
String conversationTimestamp(double ts) {
  final dt = DateTime.fromMillisecondsSinceEpoch((ts * 1000).round());
  final now = DateTime.now();
  if (_sameDay(dt, now)) {
    return '${dt.hour}:${dt.minute.toString().padLeft(2, '0')}';
  }
  final yesterday = now.subtract(const Duration(days: 1));
  if (_sameDay(dt, yesterday)) return 'Yesterday';
  return '${dt.month}/${dt.day}';
}

bool _sameDay(DateTime a, DateTime b) => a.year == b.year && a.month == b.month && a.day == b.day;
