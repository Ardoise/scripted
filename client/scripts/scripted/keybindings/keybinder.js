/*******************************************************************************
 * @license
 * Copyright (c) 2012 VMware, Inc. All Rights Reserved.
 * THIS FILE IS PROVIDED UNDER THE TERMS OF THE ECLIPSE PUBLIC LICENSE
 * ("AGREEMENT"). ANY USE, REPRODUCTION OR DISTRIBUTION OF THIS FILE
 * CONSTITUTES RECIPIENTS ACCEPTANCE OF THE AGREEMENT.
 * You can obtain a current copy of the Eclipse Public License from
 * http://www.opensource.org/licenses/eclipse-1.0.php
 *
 * Contributors:
 *     Kris De Volder
 ******************************************************************************/

//////////////////////////////////////////////////////////////////////////////////
// This module provides some API to manage keybindings in a scripted editor.
//
// Stuff like retrieve the 'current keybindings' from a live scripted editor.
// Change the keybindings etc.
//////////////////////////////////////////////////////////////////////////////////

/*global $*/

define(['./keystroke', 'scripted/utils/os', 'servlets/config-client', 'jquery'
], function (mKeystroke, OS, mConfig) {

var keyBindingConfigName = 'keymap-'+OS.name;

var keybinding2keystroke = mKeystroke.fromKeyBinding;
var keystroke2keybinding = mKeystroke.toKeyBinding;
var getScriptedRcFile = mConfig.getScriptedRcFile;
var putScriptedRcFile = mConfig.putScriptedRcFile;

/**
 * Information about the default keybindings. These are not statically known. They
 * are whatever keybindings are registered in the editor by the time 'keybinder' gets
 * a crack at changing them.
 *
 * These defaults may depend on things such as the current browser and operating system.
 * Keybindings from 'exec-keys' in .scripted also end up in the defaults. Maybe that
 * is undesirable, but for now this is how things work.
 */
var defaults = {
	keybindings: null,
	unboundNames: null
};

/**
 * Set (or unset) a keybinding on a specific editor.
 * A keybinding maps a keystroke to specific editor action.
 * @param editor Reference to a scripted editor.
 * @param {String} A Scripted keystroke string
 * @param {String|null} Name of an action to bind keystroke to an action or null to unbind.
 */
function setEditorKeyBinding(editor, keySpec, actionName) {
	var tv = editor.getTextView();
	var keepUnusedActions = true;
	tv.setKeyBinding(
		keystroke2keybinding(keySpec),
		actionName,
		keepUnusedActions //BEWARE: this parameter was added to orion code.
		                  // Original orion always removes the 'unused' actions
		                  // This is annoying since they can then no longer be
		                  // rebound to another key.
	);
}

function toJSON(kbs) {
	var json = {};
	for (var i = 0; i < kbs.length; i++) {
		var keyBinding = kbs[i];
		if (keyBinding.name) {
			json[keybinding2keystroke(keyBinding.keyBinding)] = keyBinding.name;
		}
	}
	return json;
}

/**
 * Retrieve an editor's current keybindings as JSON-able object in scripted format.
 * I.e. as a map where the property names are 'keystroke' strings and the values
 * are action names.
 */
function getKeyBindings(editor) {
	editor = editor || window.editor;
	return toJSON(editor.getTextView()._keyBindings);
}

/**
 * Dumps a current key bindings for a given editor onto the console
 * in json format. The printed format should be something we
 * can copy paste into a config file.
 */
function dumpCurrentKeyBindings(editor) {
	console.log(JSON.stringify(getKeyBindings(editor), null, '  '));
}

/**
 * Retrieve the user's custom keybindings and apply them to the given editor.
 */
function installOn(editor) {
	//Before modifying any key bindings capture current keybindings state as the defaults:
	if (!defaults.keybindings) {
		//note that defaults are only captured once even if we see multiple editor instances
		//over the lifetime of the browser window. This could be problematic if the 'defaults'
		//are not the same for all editor instances.
		console.log('default keybindings are: ');
		defaults.keybindings = getKeyBindings(editor);
		console.log(JSON.stringify(defaults.keybindings, null, '  '));
		defaults.unboundNames = getUnboundActionNames(editor);
		console.log('default unbound action names are: ');
		console.log(JSON.stringify(defaults.unboundNames));
	}
	
	return getScriptedRcFile(keyBindingConfigName).then(
		function (conf) {
			console.log('Retrieved config: '+keyBindingConfigName);
			console.log(JSON.stringify(conf, null, '  '));
			//conf is a map from keystroke strings to editor action names
			for (var k in conf) {
				if (conf.hasOwnProperty(k)) {
					setEditorKeyBinding(editor, k, conf[k]);
				}
			}
		},
		function (err) {
			console.error(err);
		}
	);
}

/**
 * Fetch a list of valid action names whether or not they are currently bound to
 * a key shortcut.
 */
function getActionNames(editor) {
	return editor.getTextView().getActions(true);
}

/**
 * Retrieve an array of all ubbound action names. I.e. valid action names that are not yet bound to
 * a keyboard shortcut.things that the editor can bind keys to.
 */
function getUnboundActionNames(editor) {
	//There's no easy/quick way to find whether there's a keybinding for a given action name
	//So we build a set of bound names first.
	var kbs = getKeyBindings(editor);
	var boundNamesMap = {};
	for (var k in kbs) {
		var boundName = kbs[k];
		if (boundName) {
			boundNamesMap[boundName] = true;
		}
	}
	return getActionNames(editor)
	.filter(function (name) {
		return !boundNamesMap[name];
	});
}

/**
 * Compute the 'difference' between two keybidning configs (in json format).
 * The resulting object contains precisely those properties that must be
 * added to the base object to obtain the target object.
 *
 * IMPORTANT: ideally this function should be playing nice with jsonMerge
 * but it does not... in general. It is only implemented here for
 * the simple case where both objects are known to contain simple values
 * like strings and nulls.
 */
function jsonDiff(base, target) {

	function eachProp(o, f) {
		for (var p in o) {
			if (o.hasOwnProperty(p)) {
				f(p, o[p]);
			}
		}
	}

	var result = {};
	eachProp(base, function (p, bv) {
		if (target.hasOwnProperty(p)) {
			//both have property 'p' keep target[p] if different.
			if (bv!==target[p]) {
				result[p] = target[p];
			}
		} else {
			//only in base... the binding must be removed
			result[p] = null;
		}
	});
	eachProp(target, function (p, tv) {
		//The only props left to handle are those that only exist in target
		//but not in base.
		if (!base.hasOwnProperty(p)) {
			result[p] = tv;
		}
	});
	
	return result;
}

function persistKeyBindings() {
	var defaultKeybindings = defaults.keybindings;
	var currentKeybindings = getKeyBindings();
	var diff = jsonDiff(defaultKeybindings, currentKeybindings);
	console.log('Should persist these key bindings now: ');
	console.log(JSON.stringify(diff, null, '  '));
	return putScriptedRcFile(keyBindingConfigName, diff);
}

/**
 * This fuctions binds a given keystroke to an editor action name.
 * It should do whatever it takes to bind this key in a all open
 * editors as well as update the config file in the user's home
 * directory to persist this keybinding.
 *
 * @return Promise that resolves when the
 */
function setKeyBinding(keystroke, actionName) {
	var subeditors = window.subeditors;
	setEditorKeyBinding(window.editor, keystroke, actionName);
	for (var i = 0; i < subeditors.length; i++) {
		setEditorKeyBinding(subeditors[i], keystroke, actionName);
	}
	$('#help_panel').trigger('refresh'); //TODO: correct way to do this would
	                                     // be to publish an event that means keybindings have changed
	                                     // not prod every UI element that might be interested.
	return persistKeyBindings();
}

return {
//	dumpActionNames: dumpActionNames,
	setKeyBinding: setKeyBinding,
	getKeyBindings: getKeyBindings,
	getUnboundActionNames: getUnboundActionNames,
//	dumpCurrentKeyBindings: dumpCurrentKeyBindings,
	installOn: installOn
};

}); //end AMD define