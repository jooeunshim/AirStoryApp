import { HeaderHeightContext } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  Keyboard,
  LayoutChangeEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  TargetedEvent,
  ViewStyle,
} from "react-native";

/** Gap left between the bottom of the focused field and the top of the keyboard. */
const FOCUS_MARGIN = 28;

/**
 * Our paddingBottom REPLACES the screen's own content padding (onboarding 28, login 24), so that
 * much has to be added back before any of the extra counts as new scroll range. Without it the net
 * gain is keyboardHeight exactly, which is what left the last field flush against the keyboard.
 * Set to the larger of the two: over-allocating only yields harmless extra headroom, whereas
 * under-allocating reintroduces the bug.
 */
const BASE_CONTENT_PADDING = 28;

/**
 * Floor for the extra allowance when the safe-area inset reads 0 (some devices/emulators report
 * no gesture bar), so the last field always keeps some headroom.
 */
const MIN_EXTRA_ALLOWANCE = 48;

// TEMPORARY diagnostic logging (see KBDIAG lines in Metro). Strip once verified on device.
const KBDIAG = true;
const diag = (...args: any[]) => {
  if (KBDIAG) console.log("[KBDIAG]", ...args);
};

/**
 * Shared plumbing for forms that must stay visible while the keyboard is up.
 *
 * The app runs Android edge-to-edge, so the window does NOT resize when the keyboard opens — it
 * overlays the content, and android.softwareKeyboardLayoutMode is ignored. Measured on device:
 * layout height stayed 856 with a 310 keyboard, and content height equalled layout height, so the
 * ScrollView had zero scroll range and scrolling a field into view was impossible by definition.
 *
 * So the fix is to create the range: pad the content by the keyboard's height while it is open.
 * Only then can the scroll-into-view call actually move anything.
 *
 * Usage: spread scrollProps onto the ScrollView and pass handleFocus to every TextInput's onFocus.
 */
export function useKeyboardAwareForm() {
  const scrollRef = useRef<ScrollView>(null);
  // Screens rendered under a visible header must offset by its height or iOS pads by the wrong
  // amount. Reading the context directly (rather than useHeaderHeight) returns undefined instead
  // of throwing when there is no header, e.g. the login screen with headerShown: false.
  const headerHeight = useContext(HeaderHeightContext) ?? 0;

  const insets = useSafeAreaInsets();
  // Headroom beyond the keyboard itself: the gap we want above the focused field, plus the
  // gesture-bar inset that the reported keyboard height leaves out under edge-to-edge.
  const extraAllowance = Math.max(insets.bottom + FOCUS_MARGIN, MIN_EXTRA_ALLOWANCE);

  const [keyboardHeight, setKeyboardHeight] = useState(0);
  /** Last focused input, so the scroll can be re-issued once the padding exists. */
  const focusedNode = useRef<number | null>(null);

  // Geometry, kept for the KBDIAG readout.
  const layoutHeight = useRef(0);
  const contentHeight = useRef(0);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    layoutHeight.current = e.nativeEvent.layout.height;
  }, []);

  const onContentSizeChange = useCallback((_w: number, h: number) => {
    contentHeight.current = h;
    diag("content h=", h, "layout h=", layoutHeight.current, "scrollable=", h - layoutHeight.current);
  }, []);

  /** Scroll a node above the keyboard. No-ops harmlessly when there is no scroll range. */
  const scrollNodeIntoView = useCallback((node: number) => {
    const sv = scrollRef.current;
    if (!sv) return;
    try {
      const responder = (sv as any).getScrollResponder?.call(sv);
      responder?.scrollResponderScrollNativeHandleToKeyboard?.(node, FOCUS_MARGIN, true);
      diag("scrolled node", node, "scrollable=", contentHeight.current - layoutHeight.current);
    } catch (err: any) {
      diag("scroll THREW:", String(err?.message || err));
    }
  }, []);

  const handleFocus = useCallback(
    (e: NativeSyntheticEvent<TargetedEvent>) => {
      // The node handle is the numeric tag on nativeEvent.target. e.target is the synthetic
      // event's target (a host component), NOT a node handle — passing it to the scroll
      // responder silently does nothing.
      const node = e.nativeEvent?.target;
      diag("handleFocus nativeEvent.target=", node, "typeof=", typeof node);
      if (typeof node !== "number") {
        diag("ABORT: no numeric node handle");
        return;
      }
      focusedNode.current = node;
      // Focus fires before keyboardDidShow, so at this instant the padding (and therefore the
      // scroll range) usually does not exist yet. Try anyway for the keyboard-already-open case;
      // the effect below re-issues it once the keyboard height lands.
      scrollNodeIntoView(node);
    },
    [scrollNodeIntoView]
  );

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (e) => {
      const h = e.endCoordinates?.height ?? 0;
      diag(
        "keyboardDidShow kbHeight=", h,
        "| insets.bottom=", insets.bottom,
        "extraAllowance=", extraAllowance,
        "=> paddingBottom=", h + BASE_CONTENT_PADDING + extraAllowance,
        "| expected scrollable≈", h + extraAllowance
      );
      setKeyboardHeight(h);
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => {
      diag("keyboardDidHide");
      setKeyboardHeight(0);
      focusedNode.current = null;
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [insets.bottom, extraAllowance]);

  // Once the padding has been applied and the content re-measured, move the focused field up.
  useEffect(() => {
    if (keyboardHeight <= 0 || focusedNode.current == null) return;
    const timer = setTimeout(() => {
      if (focusedNode.current != null) scrollNodeIntoView(focusedNode.current);
    }, 60);
    return () => clearTimeout(timer);
  }, [keyboardHeight, scrollNodeIntoView]);

  /**
   * Applied on top of the screen's own contentContainerStyle while the keyboard is open.
   *
   * paddingBottom makes the content taller than the viewport, which is the scroll range that was
   * missing. justifyContent must also flip: the base style centres the form, and centring keeps
   * the container at exactly the viewport height (flexGrow: 1), so the extra padding would just
   * push content around inside the same box instead of extending it. flex-start lets the content
   * grow downward past the fold.
   */
  const keyboardAdjustStyle: ViewStyle | null =
    keyboardHeight > 0
      ? {
          justifyContent: "flex-start",
          // keyboardHeight is measured from the bottom of the window. Under edge-to-edge that
          // excludes the navigation/gesture bar, so the inset is added on top of the visual gap.
          paddingBottom: keyboardHeight + BASE_CONTENT_PADDING + extraAllowance,
        }
      : null;

  return {
    scrollRef,
    handleFocus,
    onLayout,
    onContentSizeChange,
    keyboardHeight,
    keyboardAdjustStyle,
    behavior: Platform.OS === "ios" ? ("padding" as const) : undefined,
    keyboardVerticalOffset: headerHeight,
  };
}
