/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* Licensed under the MIT License. See LICENSE.md in the project root for license terms.
*--------------------------------------------------------------------------------------------*/
import * as React from "react";
import { mount, shallow } from "enzyme";
import { expect } from "chai";

import { MenuButton } from "../../ui-framework/accudraw/MenuButton";

describe("MenuButton", () => {
  it("should render", () => {
    mount(<MenuButton point={{ x: 100, y: 120 }} />);
  });

  it("renders correctly", () => {
    shallow(<MenuButton point={{ x: 100, y: 120 }} />).should.matchSnapshot();
  });

  it("should open and close on click", () => {
    const wrapper = mount(<MenuButton point={{ x: 100, y: 120 }} />);

    const menuButton = wrapper.find(MenuButton);
    expect(menuButton.state("expanded")).to.be.false;

    let button = wrapper.find("button.uifw-square-button");
    expect(button.length).to.eq(1);
    button.simulate("click");
    expect(menuButton.state("expanded")).to.be.true;

    wrapper.update();
    button = wrapper.find("button.uifw-square-button");
    button.simulate("click");
    expect(menuButton.state("expanded")).to.be.false;

    wrapper.unmount();
  });

});
