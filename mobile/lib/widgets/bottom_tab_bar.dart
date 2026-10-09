import 'package:flutter/material.dart';

import '../theme.dart';

enum AppTab { nearby, chats, calls }

// Baked into the bottom of every main-shell screen in the design (3.1,
// 3.1b, etc. each render it themselves rather than it being a separate
// isolated screen) - same three tabs the design's own navigation spec
// calls for, hand-drawn shapes matching the design exactly rather than an
// icon font.
class BottomTabBar extends StatelessWidget {
  final AppTab current;
  final void Function(AppTab) onSelect;

  const BottomTabBar({super.key, required this.current, required this.onSelect});

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 88,
      padding: const EdgeInsets.fromLTRB(18, 12, 18, 0),
      decoration: const BoxDecoration(
        color: Color(0xFFFDFAF6),
        border: Border(top: BorderSide(color: AgoraColors.borderSoft)),
      ),
      child: Row(
        children: [
          Expanded(child: _TabItem(label: "Nearby", icon: _nearbyIcon, active: current == AppTab.nearby, onTap: () => onSelect(AppTab.nearby))),
          Expanded(child: _TabItem(label: "Chats", icon: _chatsIcon, active: current == AppTab.chats, onTap: () => onSelect(AppTab.chats))),
          Expanded(child: _TabItem(label: "Calls", icon: _callsIcon, active: current == AppTab.calls, onTap: () => onSelect(AppTab.calls))),
        ],
      ),
    );
  }

  static Widget _nearbyIcon(bool active) => Container(
        width: 22,
        height: 22,
        decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: active ? AgoraColors.accent : AgoraColors.icon2, width: 2.5)),
        alignment: Alignment.center,
        child: Container(width: 7, height: 7, decoration: BoxDecoration(shape: BoxShape.circle, color: active ? AgoraColors.accent : Colors.transparent)),
      );

  static Widget _chatsIcon(bool active) => Container(
        width: 22,
        height: 20,
        decoration: BoxDecoration(borderRadius: BorderRadius.circular(7), border: Border.all(color: active ? AgoraColors.accent : AgoraColors.icon2, width: 2.5)),
      );

  static Widget _callsIcon(bool active) => Transform.rotate(
        angle: -0.14,
        child: Container(
          width: 21,
          height: 21,
          decoration: BoxDecoration(
            borderRadius: const BorderRadius.only(topLeft: Radius.circular(7), topRight: Radius.circular(7), bottomLeft: Radius.circular(7), bottomRight: Radius.circular(2)),
            border: Border.all(color: active ? AgoraColors.accent : AgoraColors.icon2, width: 2.5),
          ),
        ),
      );
}

class _TabItem extends StatelessWidget {
  final String label;
  final Widget Function(bool active) icon;
  final bool active;
  final VoidCallback onTap;

  const _TabItem({required this.label, required this.icon, required this.active, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          icon(active),
          const SizedBox(height: 6),
          Text(label, style: TextStyle(fontSize: 11.5, fontWeight: active ? FontWeight.w700 : FontWeight.w600, color: active ? AgoraColors.accent : AgoraColors.textMuted)),
        ],
      ),
    );
  }
}
