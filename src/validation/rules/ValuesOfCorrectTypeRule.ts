import { didYouMean } from '../../jsutils/didYouMean.js';
import { inspect } from '../../jsutils/inspect.js';
import { suggestionList } from '../../jsutils/suggestionList.js';

import { GraphQLError } from '../../error/GraphQLError.js';

import type { ValueNode } from '../../language/ast.js';
import { print } from '../../language/printer.js';
import type { ASTVisitor } from '../../language/visitor.js';

import {
  getNamedType,
  getNullableType,
  isInputObjectType,
  isLeafType,
  isListType,
  isNonNullType,
  isRequiredInputField,
} from '../../type/definition.js';

import type { ValidationContext } from '../ValidationContext.js';

/**
 * Value literals of correct type
 *
 * A GraphQL document is only valid if all value literals are of the type
 * expected at their position.
 *
 * See https://spec.graphql.org/draft/#sec-Values-of-Correct-Type
 */
export function ValuesOfCorrectTypeRule(
  context: ValidationContext,
): ASTVisitor {
  return {
    ListValue(node) {
      // Note: TypeInfo will traverse into a list's item type, so look to the
      // parent input type to check if it is a list.
      const type = getNullableType(context.getParentInputType());
      if (!isListType(type)) {
        isValidValueNode(context, node);
        return false; // Don't traverse further.
      }
    },
    ObjectValue(node) {
      const type = getNamedType(context.getInputType());
      if (!isInputObjectType(type)) {
        isValidValueNode(context, node);
        return false; // Don't traverse further.
      }
      // Ensure every required field exists.
      const fieldNodeMap = new Map(
        node.fields.map((field) => [field.name.value, field]),
      );
      for (const fieldDef of Object.values(type.getFields())) {
        const fieldNode = fieldNodeMap.get(fieldDef.name);
        if (!fieldNode && isRequiredInputField(fieldDef)) {
          const typeStr = inspect(fieldDef.type);
          context.reportError(
            new GraphQLError(
              `Field "${type.name}.${fieldDef.name}" of required type "${typeStr}" was not provided.`,
              { nodes: node },
            ),
          );
        }
      }
    },
    ObjectField(node) {
      const parentType = getNamedType(context.getParentInputType());
      const fieldType = context.getInputType();
      if (!fieldType && isInputObjectType(parentType)) {
        const suggestions = suggestionList(
          node.name.value,
          Object.keys(parentType.getFields()),
        );
        context.reportError(
          new GraphQLError(
            `Field "${node.name.value}" is not defined by type "${parentType.name}".` +
              didYouMean(suggestions),
            { nodes: node },
          ),
        );
      }
    },
    NullValue(node) {
      const type = context.getInputType();
      if (isNonNullType(type)) {
        context.reportError(
          new GraphQLError(
            `Expected value of type "${inspect(type)}", found ${print(node)}.`,
            { nodes: node },
          ),
        );
      }
    },
    EnumValue: (node) => isValidValueNode(context, node),
    IntValue: (node) => isValidValueNode(context, node),
    FloatValue: (node) => isValidValueNode(context, node),
    StringValue: (node) => isValidValueNode(context, node),
    BooleanValue: (node) => isValidValueNode(context, node),
  };
}

/**
 * Any value literal may be a valid representation of a Scalar, depending on
 * that scalar type.
 */
function isValidValueNode(context: ValidationContext, node: ValueNode): void {
  // Report any error at the full type expected by the location.
  const locationType = context.getInputType();
  if (!locationType) {
    return;
  }

  const type = getNamedType(locationType);

  if (!isLeafType(type)) {
    const typeStr = inspect(locationType);
    context.reportError(
      new GraphQLError(
        `Expected value of type "${typeStr}", found ${print(node)}.`,
        { nodes: node },
      ),
    );
    return;
  }

  // Scalars and Enums determine if a literal value is valid via parseLiteral(),
  // which may throw or return an invalid value to indicate failure.
  try {
    const parseResult = type.parseLiteral(node, undefined /* variables */);
    if (parseResult === undefined) {
      const typeStr = inspect(locationType);
      context.reportError(
        new GraphQLError(
          `Expected value of type "${typeStr}", found ${print(node)}.`,
          { nodes: node },
        ),
      );
    }
  } catch (error) {
    const typeStr = inspect(locationType);
    if (error instanceof GraphQLError) {
      context.reportError(error);
    } else {
      context.reportError(
        new GraphQLError(
          `Expected value of type "${typeStr}", found ${print(node)}; ` +
            error.message,
          { nodes: node, originalError: error },
        ),
      );
    }
  }
}
