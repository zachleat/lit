/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {type ReactiveElement} from '@lit/reactive-element';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Constructor<T = object> = new (...args: any[]) => T;

/**
 * Generates a public interface type that removes private and protected fields.
 * This allows accepting otherwise incompatible versions of the type (e.g. from
 * multiple copies of the same package in `node_modules`).
 */
type Interface<T> = {
  [K in keyof T]: T[K];
};

interface FormAssociated extends ReactiveElement {
  _checkValidity?(): ValidityResult;
}

interface FormAssociatedConstructor {
  [Symbol.metadata]: object & Record<PropertyKey, unknown>;

  role: ElementInternals['role'];

  new (): FormAssociated;
}

interface ValidityResult {
  flags: ValidityState;
  message?: string;
  anchor?: HTMLElement;
}

const internalsCache = new WeakMap<FormAssociated, ElementInternals>();

/**
 * Returns the ElementInternals for a FormAssociated element. This should only
 * be called by subclasses of FormAssociated.
 */
export const getInternals = (element: FormAssociated) =>
  internalsCache.get(element);

/**
 * Returns true if the element is disabled.
 */
export const isDisabled = (element: FormAssociated) =>
  disabledElements.has(element);

const disabledElements = new WeakSet<FormAssociated>();

/**
 * A mixin that makes a ReactiveElement into a form-associated custom element.
 *
 * - ARIA role: Sets this element's ElementInternals role to the value of the
 *   static `role` property.
 * - Form value: The value of the element is stored in the field decorated with
 *   the `@formValue()` decorator. This value field can have any name, but the
 *   type must be assignable to `string | File | FormData | null`.
 * - Form state: The state of the element is stored in the field decorated with
 *   the `@formState()` decorator. This state field can have any name, but the
 *   type must be assignable to `string | File | FormData | null`. The state
 *   field should be private, as it is only intended to be set by the
 *   FormAssociated mixin. The state field should usually be a getter/setter
 *   pair so that the form value can be derived from the state during form
 *   state restoration.
 * - Form reset: When the form is reset, the value field is set to its initial
 *   value, and the state field is set to its initial state. This means that the
 *   initial value and state will be stored for the lifetime of the element.
 * - Form state restoration: When the form is restored, the mode can be either
 *   'restore' or 'autocomplete'. In 'restore' mode, the state field is set to
 *   the state setter, if present, is set to the state that was previously
 *   passed to `internals.setFormValue()`. It's the state setter's
 *   responsibility to update the value setter. If there is no state setter, the
 *   value setter is updated directly. In 'autocomplete' mode, the value setter
 *   is updated directly.
 * - Form disabled: When the element is disabled, the `ariaDisabled` property of
 *   the ElementInternals is set to "true". The element is also added to a set
 *   of disabled elements, which can be checked with the `isDisabled()`
 *   function.
 */
export const FormAssociated = <T extends Constructor<ReactiveElement>>(
  base: T
) => {
  class C extends base {
    #internals: ElementInternals;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args);
      const internals = this.attachInternals();
      this.#internals = internals;
      internalsCache.set(this, internals);
      internals.role = (this.constructor as FormAssociatedConstructor).role;
    }

    formDisabledCallback(disabled: boolean) {
      if (disabled) {
        disabledElements.add(this);
      } else {
        disabledElements.delete(this);
      }
      this.#internals.ariaDisabled = String(disabled);
      this.requestUpdate();
    }

    formResetCallback() {
      const metadata = (this.constructor as FormAssociatedConstructor)[
        Symbol.metadata
      ];

      // Restore the initial value
      const valueAccess = valueAccessors.get(metadata);
      const initialValue = initialValues.get(this);
      valueAccess?.set(this, initialValue);

      // Restore the initial state
      const stateAccess = stateAccessors.get(metadata);
      const initialState = initialStates.get(this);
      stateAccess?.set(this, initialState);
    }

    formStateRestoreCallback(
      state: string | File | FormData | null,
      mode: 'restore' | 'autocomplete'
    ) {
      const metadata = (this.constructor as FormAssociatedConstructor)[
        Symbol.metadata
      ];
      if (mode === 'restore') {
        // When restoring a value we should get the state previously passed to
        // internals.setFormValue(). We can pass that to the state accessor,
        // which should update the value accessor.
        // If there is no state accessor, we should update the value accessor
        const stateAccess = stateAccessors.get(metadata);
        if (stateAccess !== undefined) {
          stateAccess.set(this, state);
        } else {
          const valueAccess = valueAccessors.get(metadata);
          valueAccess?.set(this, state);
        }
      } else if (mode === 'autocomplete') {
        // When autocompleting a value, we don't get a previous state object, so
        // we should update the value accessor directly.
        const valueAccess = valueAccessors.get(metadata);
        valueAccess?.set(this, state);
      }
    }
  }
  return C as Constructor<Interface<FormAssociated>> & T;
};

type Access = ClassAccessorDecoratorContext<FormAssociated, unknown>['access'];

const valueAccessors = new WeakMap<DecoratorMetadataObject, Access>();

/*
 * A store of initial values for FormAssociated elements so that they can be
 * restored when the form is reset.
 */
const initialValues = new WeakMap<FormAssociated, unknown>();

/**
 * A class accessor decorator that marks a field as the form value for the
 * FormAssociated mixin.
 */
export const formValue =
  () =>
  <V extends string | File | FormData | null>(
    target: ClassAccessorDecoratorTarget<FormAssociated, V>,
    context: ClassAccessorDecoratorContext<FormAssociated, V>
  ): ClassAccessorDecoratorResult<FormAssociated, V> => {
    valueAccessors.set(context.metadata, context.access);

    return {
      get: target.get,
      set(value: V) {
        target.set.call(this, value);
        getInternals(this)!.setFormValue(value);
      },
      init(value: V) {
        initialValues.set(this, value);
        return value;
      },
    };
  };

const stateAccessors = new WeakMap<DecoratorMetadataObject, Access>();

/*
 * A store of initial values for FormAssociated elements so that they can be
 * restored when the form is reset.
 */
const initialStates = new WeakMap<FormAssociated, unknown>();

/**
 * A class accessor decorator that marks a field as the form state for the
 * FormAssociated mixin.
 *
 * This accessor should be private. The setter should only be called by the
 * FormAssociated mixin, not by the elemen itself.
 *
 * TODO: support getter/setter pairs
 */
export const formState =
  () =>
  <V extends string | File | FormData | null>(
    target: ClassAccessorDecoratorTarget<FormAssociated, V>,
    context: ClassAccessorDecoratorContext<FormAssociated, V>
  ): ClassAccessorDecoratorResult<FormAssociated, V> => {
    stateAccessors.set(context.metadata, context.access);

    return {
      get: target.get,
      set(value: V) {
        target.set.call(this, value);
      },
      init(value: V) {
        initialStates.set(this, value);
        return value;
      },
    };
  };