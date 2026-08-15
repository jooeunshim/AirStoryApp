import { HeaderHeightContext } from "@react-navigation/elements";
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
 * Flat, generous headroom beyond the keyboard. Deliberately not computed from the safe-area inset:
 * successive attempts to derive an exact figure all came up short, and excess bottom padding is
 * invisible (it is below the last field, inside a scroll view) whereas being short breaks the form.
 */
const EXTRA_ALLOWANCE = 200;

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

  const [keyboardHeight, setKeyboardHeight] = useState(0);
  /** Last focused input, so the scroll can be re-issued once the padding exists. */
  const focusedNode = useRef<number | null>(null);
  /** Mirror of keyboardHeight for callbacks that must not capture stale state. */
  const keyboardOpen = useRef(false);

  const layoutHeight = useRef(0);
  const contentHeight = useRef(0);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    layoutHeight.current = e.nativeEvent.layout.height;
  }, []);

  /** Scroll a node above the keyboard. No-ops harmlessly when there is no scroll range. */
  const scrollNodeIntoView = useCallback((node: number, why: string) => {
    const sv = scrollRef.current;
    if (!sv) return;
    const maxScroll = contentHeight.current - layoutHeight.current;
    try {
      const responder = (sv as any).getScrollResponder?.call(sv);
      responder?.scrollResponderScrollNativeHandleToKeyboard?.(node, FOCUS_MARGIN, true);
      diag(`scroll [${why}] node=`, node, "maxScroll at call time=", maxScroll);
    } catch (err: any) {
      diag("scroll THREW:", String(err?.message || err));
    }
  }, []);

  /**
   * Re-issue the scroll only once the content has actually grown.
   *
   * This is the ordering that matters: focus fires before keyboardDidShow, and the padding lands a
   * frame later still. Scrolling on a timer can run before the ScrollView has re-measured, in which
   * case the responder clamps to the OLD maximum (the pre-padding one) and the field ends up only
   * partway up — which reads exactly like "the padding is too small".
   */
  const onContentSizeChange = useCallback(
    (_w: number, h: number) => {
      const grew = h > contentHeight.current;
      contentHeight.current = h;
      diag("content h=", h, "layout h=", layoutHeight.current, "scrollable=", h - layoutHeight.current);
      if (grew && keyboardOpen.current && focusedNode.current != null) {
        scrollNodeIntoView(focusedNode.current, "after content grew");
      }
    },
    [scrollNodeIntoView]
  );

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
      // Focus fires before keyboardDidShow, so the scroll range usually does not exist yet. Try
      // anyway for the keyboard-already-open case (switching fields); onContentSizeChange re-issues
      // it once the padding has landed.
      scrollNodeIntoView(node, "on focus");
    },
    [scrollNodeIntoView]
  );

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (e) => {
      const h = e.endCoordinates?.height ?? 0;
      keyboardOpen.current = true;
      diag(
        "keyboardDidShow kbHeight=", h,
        "=> paddingBottom=", h + BASE_CONTENT_PADDING + EXTRA_ALLOWANCE,
        "| expected scrollable≈", h + EXTRA_ALLOWANCE
      );
      setKeyboardHeight(h);
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => {
      diag("keyboardDidHide");
      keyboardOpen.current = false;
      setKeyboardHeight(0);
      focusedNode.current = null;
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // Backstop in case onContentSizeChange does not fire (e.g. the padding produced no size change
  // because the content was already tall enough to scroll).
  useEffect(() => {
    if (keyboardHeight <= 0 || focusedNode.current == null) return;
    const timer = setTimeout(() => {
      if (focusedNode.current != null) scrollNodeIntoView(focusedNode.current, "backstop timer");
    }, 250);
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
          paddingBottom: keyboardHeight + BASE_CONTENT_PADDING + EXTRA_ALLOWANCE,
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
