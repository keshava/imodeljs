/*---------------------------------------------------------------------------------------------
|  $Copyright: (c) 2018 Bentley Systems, Incorporated. All rights reserved. $
 *--------------------------------------------------------------------------------------------*/
/** @module Events */

/** A function invoked when a BeEvent is raised. */
export type Listener = (...arg: any[]) => void;

class EventContext {
  constructor(public listener: Listener | undefined, public scope: any, public once: boolean) { }
}

/**
 * A generic class for managing a set of *listeners* for a particular event.
 * This class is usually instantiated inside of a container class and
 * exposed as a property for others to *subscribe* via [[BeEvent.addListener]].
 */
export class BeEvent<T extends Listener> {
  private _listeners: EventContext[] = [];
  private _insideRaiseEvent: boolean = false;

  /** The number of listeners currently subscribed to the event. */
  public get numberOfListeners() { return this._listeners.length; }

  /**
   * Registers a Listener to be executed whenever the event is raised.
   *
   * @param listener The function to be executed when the event is raised.
   * @param scope An optional object scope to serve as the 'this' pointer when listener is invoked.
   * @returns A function that will remove this event listener.
   * @see [[BeEvent.raiseEvent]], [[BeEvent.removeListener]]
   */
  public addListener(listener: T, scope?: any): () => void {
    this._listeners.push(new EventContext(listener, scope, false));
    const event = this;
    return () => { event.removeListener(listener, scope); };
  }

  /**
   * Registers a callback function to be executed *only once* when the event is raised.
   *
   * @param listener The function to be executed once when the event is raised.
   * @param scope An optional object scope to serve as the `this`
   *        pointer in which the listener function will execute.
   * @returns A function that will remove this event listener.
   * @see [[BeEvent.raiseEvent]], [[BeEvent.removeListener]]
   */
  public addOnce(listener: T, scope?: any): () => void {
    this._listeners.push(new EventContext(listener, scope, true));
    const event = this;
    return () => { event.removeListener(listener, scope); };
  }

  /**
   * Un-register a previously registered listener.
   *
   * @param listener The listener to be unregistered.
   * @param  [scope] The scope that was originally passed to addEventListener.
   * @returns 'true' if the listener was removed; 'false' if the listener and scope are not registered with the event.
   * @see BeEvent.raiseEvent, BeEvent.addEventListener
   */
  public removeListener(listener: T, scope?: any): boolean {
    const listeners = this._listeners;

    for (let i = 0; i < listeners.length; ++i) {
      const context = listeners[i];
      if (context.listener === listener && context.scope === scope) {
        if (this._insideRaiseEvent) {
          context.listener = undefined;
        } else {
          listeners.splice(i, 1);
        }
        return true;
      }
    }
    return false;
  }

  /**
   * Raises the event by calling each registered listener with the supplied arguments.
   *
   * @param args This method takes any number of parameters and passes them through to the listeners.
   * @see BeEvent.removeListener, BeEvent.addEventListener
   */
  public raiseEvent(..._args: any[]) {
    this._insideRaiseEvent = true;

    const listeners = this._listeners;
    const length = listeners.length;
    let dropped = false;

    for (let i = 0; i < length; ++i) {
      const context = listeners[i];
      if (!context.listener) {
        dropped = true;
      } else {
        context.listener.apply(context.scope, arguments);
        if (context.once) {
          context.listener = undefined;
          dropped = true;
        }
      }

      // if we had dropped listeners, remove them now
      if (dropped) {
        this._listeners.length = 0;
        listeners.forEach((c) => { if (c.listener) this._listeners.push(c); });
      }

    }
    this._insideRaiseEvent = false;
  }

  /** Determine whether this BeEvent has a listener registered.
   * @param listener The listener to check.
   * @param scope optional scope argument to match call to addListener
   */
  public has(listener: T, scope?: any): boolean {
    for (const sub of this._listeners) {
      if (sub.listener === listener && sub.scope === scope) {
        return true;
      }
    }
    return false;
  }

  /** Clear all Listeners from this BeEvent. */
  public clear(): void { this._listeners.length = 0; }
}

/**
 * A list of BeEvent objects, accessible by an event name.
 * This class may be used instead of explicitly declaring each BeEvent as a member of a containing class.
 */
export class BeEventList<T extends Listener> {
  private _events: { [name: string]: BeEvent<T> | undefined; } = {};

  /**
   * Gets the BeEvent associated with a name.
   * @param name The name of the event.
   * @note the BeEvent will be created if none existed before this call.
   */
  public get(name: string): BeEvent<T> {
    let event = this._events[name];
    if (event)
      return event;

    event = new BeEvent();
    this._events[name] = event;
    return event;
  }

  /**
   * Removes the BeEvent associated with a name.
   * @param name The name of the event.
   */
  public remove(name: string): void {
    this._events[name] = undefined;
  }
}
