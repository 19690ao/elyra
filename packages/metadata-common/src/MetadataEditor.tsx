/*
 * Copyright 2018-2021 Elyra Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { MetadataService, IDictionary } from '@elyra/services';
import { DropDown, RequestErrors, TextInput } from '@elyra/ui-components';

import { ILabStatus } from '@jupyterlab/application';
import { ReactWidget, showDialog, Dialog } from '@jupyterlab/apputils';
import { CodeEditor, IEditorServices } from '@jupyterlab/codeeditor';

import { find } from '@lumino/algorithm';
import { IDisposable } from '@lumino/disposable';
import { Message } from '@lumino/messaging';
import {
  InputLabel,
  FormHelperText,
  Button,
  createMuiTheme,
  ThemeProvider
} from '@material-ui/core';

import * as React from 'react';

import { MetadataEditorTags } from './MetadataEditorTags';

const ELYRA_METADATA_EDITOR_CLASS = 'elyra-metadataEditor';
const ELYRA_METADATA_EDITOR_DARK_CLASS = 'elyra-metadataEditor-dark';
const DIRTY_CLASS = 'jp-mod-dirty';

interface IMetadataEditorProps {
  schema: string;
  namespace: string;
  name?: string;
  code?: string[];
  onSave: () => void;
  editorServices: IEditorServices | null;
  status: ILabStatus;
  darkMode?: boolean;
}

const lightTheme = createMuiTheme({
  palette: {
    type: 'light'
  }
});

const darkTheme = createMuiTheme({
  palette: {
    type: 'dark'
  }
});

/**
 * Metadata editor widget
 */
export class MetadataEditor extends ReactWidget {
  onSave: () => void;
  displayName: string;
  editorServices: IEditorServices;
  status: ILabStatus;
  editor: CodeEditor.IEditor;
  schemaName: string;
  schemaDisplayName: string;
  namespace: string;
  name: string;
  code: string[];
  dirty: boolean;
  allTags: string[];
  clearDirty: IDisposable;
  requiredFields: string[];
  invalidForm: boolean;
  showSecure: IDictionary<boolean>;
  widgetClass: string;
  _darkMode?: boolean;

  schema: IDictionary<any> = {};
  schemaPropertiesByCategory: IDictionary<string[]> = {};
  allMetadata: IDictionary<any>[] = [];
  metadata: IDictionary<any> = {};

  constructor(props: IMetadataEditorProps) {
    super();
    this.editorServices = props.editorServices;
    this.status = props.status;
    this.clearDirty = null;
    this.namespace = props.namespace;
    this.schemaName = props.schema;
    this.allTags = [];
    this.onSave = props.onSave;
    this.name = props.name;
    this.code = props.code;

    this.widgetClass = `elyra-metadataEditor-${this.name ? this.name : 'new'}`;
    this.addClass(this.widgetClass);

    this.handleTextInputChange = this.handleTextInputChange.bind(this);
    this.handleChangeOnTag = this.handleChangeOnTag.bind(this);
    this.handleDropdownChange = this.handleDropdownChange.bind(this);
    this.renderField = this.renderField.bind(this);

    this.invalidForm = false;

    this.showSecure = {};

    this.initializeMetadata();
  }

  async initializeMetadata(): Promise<void> {
    try {
      const schemas = await MetadataService.getSchema(this.namespace);
      for (const schema of schemas) {
        if (this.schemaName === schema.name) {
          this.schema = schema.properties.metadata.properties;
          this.schemaDisplayName = schema.title;
          this.requiredFields = schema.properties.metadata.required;
          if (!this.name) {
            this.title.label = `New ${this.schemaDisplayName}`;
          }
          // Find categories of all schema properties
          this.schemaPropertiesByCategory = { _noCategory: [] };
          for (const schemaProperty in this.schema) {
            const category =
              this.schema[schemaProperty].uihints &&
              this.schema[schemaProperty].uihints.category;
            if (!category) {
              this.schemaPropertiesByCategory['_noCategory'].push(
                schemaProperty
              );
            } else if (this.schemaPropertiesByCategory[category]) {
              this.schemaPropertiesByCategory[category].push(schemaProperty);
            } else {
              this.schemaPropertiesByCategory[category] = [schemaProperty];
            }
          }
          break;
        }
      }
    } catch (error) {
      RequestErrors.serverError(error);
    }

    try {
      this.allMetadata = await MetadataService.getMetadata(this.namespace);
    } catch (error) {
      RequestErrors.serverError(error);
    }
    if (this.name) {
      for (const metadata of this.allMetadata) {
        if (metadata.metadata.tags) {
          for (const tag of metadata.metadata.tags) {
            if (!this.allTags.includes(tag)) {
              this.allTags.push(tag);
            }
          }
        } else {
          metadata.metadata.tags = [];
        }
        if (this.name === metadata.name) {
          this.metadata = metadata['metadata'];
          this.displayName = metadata['display_name'];
          this.title.label = this.displayName;
        }
      }
    } else {
      this.displayName = '';
    }
    this.onInitializedMetadata();
    this.update();
  }

  private isValueEmpty(schemaValue: any): boolean {
    return (
      schemaValue === undefined ||
      schemaValue === null ||
      schemaValue === '' ||
      (Array.isArray(schemaValue) && schemaValue.length === 0) ||
      (Array.isArray(schemaValue) &&
        schemaValue.length === 1 &&
        schemaValue[0] === '') ||
      schemaValue === '(No selection)'
    );
  }

  get darkMode(): boolean {
    return this._darkMode ?? false;
  }

  set darkMode(value: boolean) {
    this._darkMode = value;
    this.update();
  }

  /**
   * Checks that all required fields have a value before submitting the form.
   * Returns false if the form is valid. Sets any invalid fields' intent to danger
   * so that the form will highlight the input(s) causing issues in red.
   */
  hasInvalidFields(): boolean {
    this.invalidForm = false;
    if (this.displayName === null || this.displayName === '') {
      this.invalidForm = true;
    }
    for (const schemaField in this.schema) {
      const value =
        this.metadata[schemaField] || this.schema[schemaField].default;
      if (
        this.requiredFields.includes(schemaField) &&
        this.isValueEmpty(value)
      ) {
        this.invalidForm = true;
        this.schema[schemaField].uihints.error = true;
      } else {
        this.schema[schemaField].uihints.error = false;
      }
    }
    return this.invalidForm;
  }

  onCloseRequest(msg: Message): void {
    if (this.dirty) {
      showDialog({
        title: 'Close without saving?',
        body: (
          <p>
            {' '}
            {`"${this.displayName}" has unsaved changes, close without saving?`}{' '}
          </p>
        ),
        buttons: [Dialog.cancelButton(), Dialog.okButton()]
      }).then((response: any): void => {
        if (response.button.accept) {
          this.dispose();
          super.onCloseRequest(msg);
        }
      });
    } else {
      this.dispose();
      super.onCloseRequest(msg);
    }
  }

  saveMetadata(): void {
    const newMetadata: any = {
      schema_name: this.schemaName,
      display_name: this.displayName,
      metadata: this.metadata
    };

    if (this.hasInvalidFields()) {
      this.update();
      return;
    }

    if (!this.name) {
      MetadataService.postMetadata(this.namespace, JSON.stringify(newMetadata))
        .then((response: any): void => {
          this.handleDirtyState(false);
          this.onSave();
          this.close();
        })
        .catch(error => RequestErrors.serverError(error));
    } else {
      MetadataService.putMetadata(
        this.namespace,
        this.name,
        JSON.stringify(newMetadata)
      )
        .then((response: any): void => {
          this.handleDirtyState(false);
          this.onSave();
          this.close();
        })
        .catch(error => RequestErrors.serverError(error));
    }
  }

  handleTextInputChange(event: any, schemaField: string): void {
    this.handleDirtyState(true);
    // Special case because all metadata has a display name
    if (schemaField === 'display_name') {
      this.displayName = event.nativeEvent.target.value;
    } else if (
      !event.nativeEvent.target.value &&
      !this.requiredFields.includes(schemaField)
    ) {
      delete this.metadata[schemaField];
    } else {
      this.metadata[schemaField] = event.nativeEvent.target.value;
    }
  }

  handleDropdownChange = (schemaField: string, value: string): void => {
    this.handleDirtyState(true);
    this.metadata[schemaField] = value;
    if (schemaField === 'language') {
      const getMimeTypeByLanguage = this.editorServices.mimeTypeService
        .getMimeTypeByLanguage;
      this.editor.model.mimeType = getMimeTypeByLanguage({
        name: value,
        codemirror_mode: value
      });
    }
    this.update();
  };

  handleDirtyState(dirty: boolean): void {
    this.dirty = dirty;
    if (this.dirty && !this.clearDirty) {
      this.clearDirty = this.status.setDirty();
    } else if (!this.dirty && this.clearDirty) {
      this.clearDirty.dispose();
      this.clearDirty = null;
    }
    if (this.dirty && !this.title.className.includes(DIRTY_CLASS)) {
      this.title.className += DIRTY_CLASS;
    } else if (!this.dirty) {
      this.title.className = this.title.className.replace(DIRTY_CLASS, '');
    }
  }

  onInitializedMetadata(): void {
    // If the update request triggered rendering a 'code' input, and the editor hasn't
    // been initialized yet, create the editor and attach it to the 'code' node
    if (!this.editor && document.getElementById('code:' + this.id) != null) {
      let initialCodeValue = '';
      const getMimeTypeByLanguage = this.editorServices.mimeTypeService
        .getMimeTypeByLanguage;
      // If the file already exists, initialize the code editor with the existing code
      if (this.name) {
        initialCodeValue = this.metadata['code'].join('\n');
      } else {
        if (this.code) {
          this.metadata['code'] = this.code;
          initialCodeValue = this.code!.join('\n');
        }
      }
      this.editor = this.editorServices.factoryService.newInlineEditor({
        host: document.getElementById('code:' + this.id),
        model: new CodeEditor.Model({
          value: initialCodeValue,
          mimeType: getMimeTypeByLanguage({
            name: this.metadata['language'],
            codemirror_mode: this.metadata['language']
          })
        })
      });
      this.editor.model.value.changed.connect((args: any) => {
        this.metadata['code'] = args.text.split('\n');
        this.handleDirtyState(true);
      });
    }
  }

  getDefaultChoices(fieldName: string): any[] {
    let defaultChoices = this.schema[fieldName].enum;
    if (!defaultChoices) {
      defaultChoices =
        Object.assign([], this.schema[fieldName].uihints.default_choices) || [];
      for (const otherMetadata of this.allMetadata) {
        if (
          // Don't include the current metadata
          otherMetadata !== this.metadata &&
          // Don't add if otherMetadata hasn't defined field
          otherMetadata.metadata[fieldName] &&
          !find(defaultChoices, (choice: string) => {
            return (
              choice.toLowerCase() ===
              otherMetadata.metadata[fieldName].toLowerCase()
            );
          })
        ) {
          defaultChoices.push(otherMetadata.metadata[fieldName]);
        }
      }
    }
    return defaultChoices;
  }

  onAfterShow(msg: Message): void {
    const input = document.querySelector(
      `.${this.widgetClass} .elyra-metadataEditor-form-display_name input`
    ) as HTMLInputElement;
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  renderField(fieldName: string): React.ReactElement {
    let uihints = this.schema[fieldName].uihints;
    const required =
      this.requiredFields && this.requiredFields.includes(fieldName);
    const defaultValue = this.schema[fieldName].default || '';
    if (uihints === undefined) {
      uihints = {};
      this.schema[fieldName].uihints = uihints;
    }
    if (
      uihints.field_type === 'textinput' ||
      uihints.field_type === undefined
    ) {
      return (
        <TextInput
          label={this.schema[fieldName].title}
          description={this.schema[fieldName].description}
          fieldName={fieldName}
          defaultValue={this.metadata[fieldName] || defaultValue}
          required={required}
          secure={uihints.secure}
          error={uihints.error}
          placeholder={uihints.placeholder}
          handleTextInputChange={this.handleTextInputChange}
        />
      );
    } else if (uihints.field_type === 'dropdown') {
      return (
        <DropDown
          label={this.schema[fieldName].title}
          schemaField={fieldName}
          description={this.schema[fieldName].description}
          required={required}
          error={uihints.error}
          choice={this.metadata[fieldName]}
          defaultChoices={this.getDefaultChoices(fieldName)}
          handleDropdownChange={this.handleDropdownChange}
          allowCreate={!this.schema[fieldName].enum}
        ></DropDown>
      );
    } else if (uihints.field_type === 'code') {
      let helperText = null;
      if (uihints.error) {
        helperText = (
          <FormHelperText error> This field is required. </FormHelperText>
        );
      }
      return (
        <div
          className={'elyra-metadataEditor-formInput elyra-metadataEditor-code'}
        >
          <InputLabel required={required}>
            {this.schema[fieldName].title}
          </InputLabel>
          <div id={'code:' + this.id} className="elyra-form-code"></div>
          {helperText}
        </div>
      );
    } else if (uihints.field_type === 'tags') {
      return (
        <div className="elyra-metadataEditor-formInput">
          <InputLabel> Tags </InputLabel>
          <MetadataEditorTags
            selectedTags={this.metadata.tags}
            tags={this.allTags}
            handleChange={this.handleChangeOnTag}
          />
        </div>
      );
    } else {
      return;
    }
  }

  handleChangeOnTag(selectedTags: string[], allTags: string[]): void {
    this.handleDirtyState(true);
    this.metadata.tags = selectedTags;
    this.allTags = allTags;
  }

  render(): React.ReactElement {
    const inputElements = [];
    for (const category in this.schemaPropertiesByCategory) {
      if (category !== '_noCategory') {
        inputElements.push(
          <h4 style={{ flexBasis: '100%', padding: '10px' }}>{category}</h4>
        );
      }
      for (const schemaProperty of this.schemaPropertiesByCategory[category]) {
        inputElements.push(this.renderField(schemaProperty));
      }
    }
    let headerText = `Edit "${this.displayName}"`;
    if (!this.name) {
      headerText = `Add new ${this.schemaDisplayName}`;
    }
    const error = this.displayName === '' && this.invalidForm;
    return (
      <ThemeProvider theme={this.darkMode ? darkTheme : lightTheme}>
        <div
          className={`${ELYRA_METADATA_EDITOR_CLASS} ${
            this.darkMode ? ELYRA_METADATA_EDITOR_DARK_CLASS : ''
          }`}
        >
          <h3> {headerText} </h3>
          <InputLabel style={{ width: '100%', marginBottom: '10px' }}>
            All fields marked with an asterisk are required
          </InputLabel>
          {this.displayName !== undefined ? (
            <TextInput
              label={'Name'}
              description={''}
              fieldName={'display_name'}
              defaultValue={this.displayName}
              required={true}
              secure={false}
              error={error}
              handleTextInputChange={this.handleTextInputChange}
            />
          ) : null}
          {inputElements}
          <div
            className={
              'elyra-metadataEditor-formInput elyra-metadataEditor-saveButton'
            }
          >
            <Button
              variant="outlined"
              color="primary"
              onClick={(): void => {
                this.saveMetadata();
              }}
            >
              Save & Close
            </Button>
          </div>
        </div>
      </ThemeProvider>
    );
  }
}
