import 'package:flutter/material.dart';

// Matches the design file's own `agRing` keyframe (see frontend/src/index.css
// for how this was reverse-engineered from the described effect, since the
// design bundle's computed styles reference the animation by name but don't
// expose the keyframe body itself): scale 0.85->1.35, opacity 0.7->0, one
// ring every `period`, a second ring offset by `stagger` so there are always
// two expanding rings visible at once, same as the design's two <div>s with
// staggered animation-delay.
class PresenceRings extends StatefulWidget {
  final double size;
  final Color color;
  final double strokeWidth;
  final Duration period;
  final Duration stagger;

  const PresenceRings({
    super.key,
    required this.size,
    required this.color,
    this.strokeWidth = 2,
    this.period = const Duration(milliseconds: 2600),
    this.stagger = const Duration(milliseconds: 900),
  });

  @override
  State<PresenceRings> createState() => _PresenceRingsState();
}

class _PresenceRingsState extends State<PresenceRings> with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(vsync: this, duration: widget.period)..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  double _phase(double offsetMs) {
    final total = widget.period.inMilliseconds;
    final t = (_controller.lastElapsedDuration?.inMilliseconds ?? 0) + offsetMs;
    return (t % total) / total;
  }

  Widget _ring(double phase) {
    final scale = 0.85 + (1.35 - 0.85) * phase;
    final opacity = (0.7 * (1 - phase)).clamp(0.0, 1.0);
    return Opacity(
      opacity: opacity,
      child: Transform.scale(
        scale: scale,
        child: Container(
          width: widget.size,
          height: widget.size,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            border: Border.all(color: widget.color, width: widget.strokeWidth),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        return SizedBox(
          width: widget.size * 1.4,
          height: widget.size * 1.4,
          child: Stack(
            alignment: Alignment.center,
            children: [
              _ring(_phase(0)),
              _ring(_phase(widget.stagger.inMilliseconds.toDouble())),
            ],
          ),
        );
      },
    );
  }
}

// Matches `agBlink`: hard on/off, 50% duty cycle.
class BlinkText extends StatefulWidget {
  final String text;
  final TextStyle style;
  final Duration period;

  const BlinkText({super.key, required this.text, required this.style, this.period = const Duration(milliseconds: 1800)});

  @override
  State<BlinkText> createState() => _BlinkTextState();
}

class _BlinkTextState extends State<BlinkText> with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(vsync: this, duration: widget.period)..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        final visible = _controller.value < 0.5;
        return Opacity(opacity: visible ? 1 : 0, child: Text(widget.text, style: widget.style));
      },
    );
  }
}
